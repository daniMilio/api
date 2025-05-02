insert into e_player_roles ("value", "description") values
    ('user', 'Basic User'),
    ('verified_user', 'Verified User'),
    ('match_organizer', 'Ability Manage Matches and bypass restrictions'),
    ('tournament_organizer', 'Ability Create and Manage Tournaments'),
    ('administrator', 'Administrator')
on conflict(value) do update set "description" = EXCLUDED."description"
