drop function if exists public.demo_download_url(match_map public.match_maps);

CREATE OR REPLACE FUNCTION public.demo_download_url(match_map_demos public.match_map_demos)
    RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
    DECLARE
        _file text;
        worker_url text;
    BEGIN
        SELECT value INTO worker_url 
        FROM settings 
        WHERE name = 'cloudflare_worker_url';

        IF worker_url IS NOT NULL THEN
            RETURN CONCAT(worker_url, '/demo?file=', match_map_demos.file);
        END IF;

        RETURN NULL;
    END;
$$;