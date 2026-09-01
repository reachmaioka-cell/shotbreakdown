declare module "@ffmpeg-installer/ffmpeg" {
  const installer: { path: string; version: string };
  export default installer;
}

declare module "@ffprobe-installer/ffprobe" {
  const ffprobe: { path: string; version: string };
  export default ffprobe;
}
