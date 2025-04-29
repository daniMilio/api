CREATE OR REPLACE FUNCTION public.demo_download_url(match_map public.match_maps)
RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
    worker_url text;
    filenames text[];
    demos_domain text;
BEGIN
    SELECT value INTO worker_url 
    FROM settings 
    WHERE name = 'cloudflare_worker_url';

    IF worker_url IS NOT NULL THEN
        SELECT array_agg(file) INTO filenames 
        FROM match_map_demos 
        WHERE match_map_id = match_map.id;
    
        RETURN CONCAT(worker_url, '/demos?matchId=', match_map.match_id, '&mapId=', match_map.id, '&files=', array_to_string(filenames, ','));
    END IF;

    SELECT value INTO demos_domain
    FROM settings
    WHERE name = 'demos_domain';

    RETURN CONCAT(demos_domain, '/demos/', match_map.match_id, '/map/', match_map.id);
END;
$$;
