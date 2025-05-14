import {
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import AcpPlugin from "@virtuals-protocol/game-acp-plugin";
import { Store } from "./store";

// Type for the API request body
interface ImageGenerationRequest {
  character_prompt: string;
  art_style: string;
}

// Type for the API responses
interface ApiResponse<T> {
  error: null | string;
  data: T;
}

// Function to generate avatar
export const generateAvatar = (acpPlugin: AcpPlugin) =>
  new GameFunction({
    name: "generate_avatar",
    description: "Generate an avatar image and retrieve it after processing",
    args: [
      {
        name: "art_style",
        type: "string",
        description:
          "Art style for the avatar (must be one of: 'stylised 3d', 'anime', 'art style')",
      },
    ] as const,
    executable: async (args, logger) => {
      try {
        const { art_style } = args;

        if (!art_style) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Art style is required",
          );
        }

        const store = new Store();
        const agentState = await store.getAgentState(acpPlugin);
        const projectId = Object.keys(agentState.project)[0];

        if (!projectId || !agentState.project[projectId]?.Strategy) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "No strategy found to generate avatar from",
          );
        }

        const strategy = agentState.project[projectId].Strategy;
        if (strategy.status !== "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Strategy is not yet completed",
          );
        }

        if (!strategy.value) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Strategy content is missing",
          );
        }

        // Check if avatar already exists
        if (agentState.project[projectId]?.Avatar?.status === "COMPLETED") {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Avatar has already been generated",
          );
        }

        // Validate art style
        const validArtStyles = ["stylised 3d", "anime", "art style"];
        if (!validArtStyles.includes(art_style.toLowerCase())) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            `Invalid art style. Must be one of: ${validArtStyles.join(", ")}`,
          );
        }

        const avatarRecommendations = strategy.value.avatar_recommendations;
        const characterVisuals =
          avatarRecommendations.character_visuals.character1;

        // Construct the prompt from character visuals
        const prompt = `
        Type: Character
        Art Style: ${art_style}
        Vibe/Personality: ${characterVisuals.description.gender}, ${characterVisuals.description.age}
        Details: ${characterVisuals.description.face_skin}, ${characterVisuals.description.eye_color}, ${characterVisuals.description.body_type}, ${characterVisuals.description.clothing_style}, ${characterVisuals.description.accessories}, ${characterVisuals.description.distinguishing_features}
        `;

        // Create project
        const requestBody: ImageGenerationRequest = {
          character_prompt: prompt,
          art_style: art_style,
        };

        logger("Creating project for avatar generation...");
        const createResponse = await fetch(
          "https://rbrgqdnnkyrshfhyjeeh.supabase.co/functions/v1/start-project",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization:
                "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicmdxZG5ua3lyc2hmaHlqZWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MzUzNTMsImV4cCI6MjA1OTMxMTM1M30.5_W1gScMt80QGngUjs6au9ETqnnqckD7dF_fnKhx1bw",
            },
            body: JSON.stringify(requestBody),
          },
        );

        if (!createResponse.ok) {
          throw new Error(
            `Project creation failed with status ${createResponse.status}`,
          );
        }

        const createResult = (await createResponse.json()) as ApiResponse<{
          project_id: string;
        }>;
        const avatarProjectId = createResult.data.project_id;
        logger(`Project created successfully with ID: ${avatarProjectId}`);

        // Wait for 3 minutes to allow for image generation
        logger("Waiting 3 minutes for image generation to complete...");
        await new Promise((resolve) => setTimeout(resolve, 180000));

        // Get generated images
        logger(`Fetching generated images for project ${projectId}...`);
        const imagesResponse = await fetch(
          `https://rbrgqdnnkyrshfhyjeeh.supabase.co/functions/v1/list-generated-images/${avatarProjectId}`,
          {
            headers: {
              Authorization:
                "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJicmdxZG5ua3lyc2hmaHlqZWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MzUzNTMsImV4cCI6MjA1OTMxMTM1M30.5_W1gScMt80QGngUjs6au9ETqnnqckD7dF_fnKhx1bw",
            },
          },
        );

        if (!imagesResponse.ok) {
          throw new Error(
            `Failed to get images with status ${imagesResponse.status}`,
          );
        }

        const imagesResult = (await imagesResponse.json()) as ApiResponse<{
          project_id: string;
          is_generating: boolean;
          images: Array<{
            id: string;
            created_at: string;
            prompt: string;
            file_path: string;
            status: string;
            project_id: string;
            piapi_task_id: string;
            scene_id: string | null;
            generation_attempts: number;
          }>;
        }>;

        logger(`Retrieved ${imagesResult.data.images.length} generated images`);

        // Select the first image
        const selectedImage = imagesResult.data.images[0];
        if (!selectedImage) {
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "No images were generated",
          );
        }

        // Check if the image is still processing
        if (!selectedImage.file_path) {
          logger("Image is still processing, waiting for media URL...");
          return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            "Image is still processing. Please try again after a few moments.",
          );
        }

        // Update the state with the generated avatar
        await store.setJob(projectId, "Avatar", {
          status: "COMPLETED",
          id: projectId,
          url: selectedImage.file_path,
        });

        // Return the selected image details
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done,
          JSON.stringify({
            selected_image: {
              media_url: selectedImage.file_path,
              prompt: selectedImage.prompt,
              project_id: projectId,
              image_id: selectedImage.id,
              created_at: selectedImage.created_at,
              status: selectedImage.status,
            },
            message: "Successfully generated and selected avatar image",
            project_id: projectId,
          }),
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger(`Error in avatar generation: ${errorMessage}`);
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          `Failed to generate avatar: ${errorMessage}`,
        );
      }
    },
  });
