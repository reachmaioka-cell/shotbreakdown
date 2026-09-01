-- AI tool research sources for continuous learning worker.

insert into public.learning_sources (kind, value, tags, priority, interval_hours) values
  ('search_query', 'Runway Gen-3 Alpha cinematography prompt camera control tutorial', array['runway', 'ai-generated', 'video-gen'], 13, 8),
  ('search_query', 'Pika AI video generation cinematic lighting prompt guide', array['pika', 'ai-generated', 'video-gen'], 13, 8),
  ('search_query', 'OpenAI Sora video prompt cinematography examples', array['sora', 'ai-generated', 'video-gen'], 12, 12),
  ('search_query', 'Midjourney cinematic film still prompt parameters aspect ratio', array['midjourney', 'ai-generated', 'image-gen'], 12, 12),
  ('search_query', 'ComfyUI ControlNet depth map cinematography workflow', array['comfyui', 'controlnet', 'workflow'], 12, 12),
  ('search_query', 'Flux AI photorealistic image generation filmmaker use cases', array['flux', 'ai-generated', 'image-gen'], 11, 12),
  ('search_query', 'Kling AI text to video realistic motion tutorial', array['kling', 'ai-generated', 'video-gen'], 11, 12),
  ('search_query', 'AI video lip sync Runway Act-One character animation', array['runway', 'character', 'post'], 10, 24),
  ('search_query', 'recreate music video shot AI generated Runway Pika workflow', array['ai-generated', 'music-video', 'workflow'], 11, 8),
  ('search_query', 'AI generated vs practical footage how to tell cinematography', array['ai-generated', 'detection', 'post'], 10, 24)
on conflict (kind, value) do nothing;
