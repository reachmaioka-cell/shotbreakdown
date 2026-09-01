-- Expand recurring learning sources (DP interviews, music video BTS, AI tools).

insert into public.learning_sources (kind, value, tags, priority, interval_hours) values
  ('search_query', 'Roger Deakins cinematography interview lighting', array['Roger-Deakins', 'lighting'], 11, 48),
  ('search_query', 'Greig Fraser Dune cinematography LED volume', array['Greig-Fraser', 'sci-fi'], 11, 48),
  ('search_query', 'Hoyte van Hoytema IMAX natural light technique', array['IMAX', 'natural-light'], 11, 48),
  ('search_query', 'music video cinematography BTS lighting camera', array['music-video', 'bts'], 11, 12),
  ('search_query', 'filmmaker Instagram cinematography gear breakdown', array['bts', 'gear'], 10, 12),
  ('search_query', 'visual effects breakdown compositing film', array['vfx', 'post'], 10, 24),
  ('search_query', 'AI video Runway Pika Sora cinematography workflow', array['ai-generated', 'post'], 9, 24)
on conflict (kind, value) do nothing;
