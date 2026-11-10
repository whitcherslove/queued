-- Queued · Telegram posts: off for everyone by default (each person turns them on in Profile and settings). Safe to run more than once.
alter table public.profiles alter column telegram_off set default true;
update public.profiles set telegram_off = true where telegram_off = false;
-- to keep yourself on, uncomment:
-- update public.profiles p set telegram_off = false from auth.users u where u.id = p.id and u.email = 'sumbelka14@gmail.com';
