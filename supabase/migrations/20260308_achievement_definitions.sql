-- Backend-configurable achievement definitions for /account/achievements.
-- Stores display/tag text, level mappings, ordering, and default multipliers.

create table if not exists public.achievement_definitions (
  key text primary key,
  title text not null,
  badge text not null,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  base_multiplier numeric(8,4) not null default 1.0000 check (base_multiplier >= 1.0000),
  locked_tag_label text,
  unlocked_tag_label_template text,
  locked_description text,
  unlocked_description_template text,
  level_config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint achievement_definitions_key_not_empty check (length(trim(key)) > 0),
  constraint achievement_definitions_title_not_empty check (length(trim(title)) > 0),
  constraint achievement_definitions_badge_not_empty check (length(trim(badge)) > 0),
  constraint achievement_definitions_level_config_object check (jsonb_typeof(level_config) = 'object'),
  constraint achievement_definitions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists achievement_definitions_enabled_sort_idx
  on public.achievement_definitions (enabled, sort_order, key);

create or replace function public.bb_touch_achievement_definitions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists achievement_definitions_touch_updated_at on public.achievement_definitions;
create trigger achievement_definitions_touch_updated_at
before update on public.achievement_definitions
for each row
execute function public.bb_touch_achievement_definitions_updated_at();

insert into public.achievement_definitions (
  key,
  title,
  badge,
  enabled,
  sort_order,
  base_multiplier,
  locked_tag_label,
  unlocked_tag_label_template,
  locked_description,
  unlocked_description_template,
  level_config,
  metadata,
  updated_by
)
values
  (
    'vebetter_vote_bonus',
    'VeBetterDAO Voter',
    'governance',
    true,
    10,
    1.0000,
    '投票用户',
    '投票用户',
    '在 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。',
    '在 VeBetterDAO 任一投票中参与过投票，下期获得 BigPortal 积分加成。',
    '{}'::jsonb,
    jsonb_build_object('kind', 'vote_bonus'),
    'migration:20260308_achievement_definitions'
  ),
  (
    'gm_nft',
    'GM-NFT',
    'gm_nft',
    true,
    20,
    1.0000,
    'GM-NFT',
    'GM-NFT · {{level_name}}',
    '未检测到 GM-NFT。',
    '已持有最高等级 GM-NFT：{{level_name}}',
    jsonb_build_object(
      'level_names',
      jsonb_build_object(
        '0', 'No GM NFT',
        '1', 'Earth',
        '2', 'Moon',
        '3', 'Mercury',
        '4', 'Venus',
        '5', 'Mars',
        '6', 'Jupiter',
        '7', 'Saturn',
        '8', 'Uranus',
        '9', 'Neptune',
        '10', 'Galaxy'
      )
    ),
    jsonb_build_object('kind', 'gm_nft'),
    'migration:20260308_achievement_definitions'
  )
on conflict (key) do nothing;
