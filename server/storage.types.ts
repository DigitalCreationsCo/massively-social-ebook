import { z } from "zod";

export const GcsObjectType = z.union([
  z.literal("batch-data"),
  z.literal("thumbnail"),
  z.literal("final_output"),
  z.literal("scene_video"),
  z.literal("scene_start_frame"),
  z.literal("scene_end_frame"),
  z.literal("render_video"),
  z.literal("image_file"),
  z.literal("character_image"),
  z.literal("location_image"),
]);

export type GcsObjectType = z.infer<typeof GcsObjectType>;

type ObjectPathParam<T extends GcsObjectType> = {
  type: T;
  uniqueId?: string;
};

type ThumbnailParam = ObjectPathParam<"thumbnail"> & {
  projectId: string;
  version: number;
};
type FinalOutputParam = ObjectPathParam<"final_output"> & {
  projectId: string;
  version: number;
};
type CharacterImageParam = ObjectPathParam<"character_image"> & {
  projectId: string;
  characterId: string;
  version: number;
};
type LocationImageParam = ObjectPathParam<"location_image"> & {
  projectId: string;
  locationId: string;
  version: number;
};
type SceneVideoParam = ObjectPathParam<"scene_video"> & {
  projectId: string;
  sceneId: string;
  version: number;
};
type SceneStartFrameParam = ObjectPathParam<"scene_start_frame"> & {
  projectId: string;
  sceneId: string;
  version: number;
};
type SceneEndFrameParam = ObjectPathParam<"scene_end_frame"> & {
  projectId: string;
  sceneId: string;
  version: number;
};
type RenderVideoParam = ObjectPathParam<"render_video"> & {
  projectId: string;
  version: number;
};
type BatchParam = ObjectPathParam<"batch-data"> & { projectId: string };
type ImageParam = ObjectPathParam<"image_file"> & {
  projectId: string;
  imageId: string;
  version: number;
};

export type GcsObjectPathParams =
  | ThumbnailParam
  | FinalOutputParam
  | CharacterImageParam
  | LocationImageParam
  | SceneVideoParam
  | SceneStartFrameParam
  | SceneEndFrameParam
  | RenderVideoParam
  | ImageParam
  | BatchParam;
