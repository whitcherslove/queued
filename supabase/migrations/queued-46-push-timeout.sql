-- Queued · calls to the "push" function get 20 seconds instead of 5 (a Telegram post with a picture can take longer).
-- The call still runs in the background — nothing in the app waits for it. Safe to run more than once.
create or replace function public.push_call(body jsonb) returns void language plpgsql security definer set search_path = public as $$
declare url text; secret text;
begin
  select value into url from public.app_config where key = 'push_url';
  select value into secret from public.app_config where key = 'push_secret';
  if url is null or secret is null then return; end if;
  perform net.http_post(url := url, body := body, headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', secret),
                        timeout_milliseconds := 20000);
end $$;
