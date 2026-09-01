/** Client-safe shape of an extracted frame. */
export type ShotFrame = {
  id: string;
  timestampSeconds: number;
  url: string | null;
  thumbUrl: string | null;
  isRepresentative: boolean;
  score: number | null;
};
