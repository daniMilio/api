CREATE OR REPLACE FUNCTION public.taiu_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    server_node record;
    server_ip inet;
BEGIN
    IF(NEW.name = 'update_map_pools' and NEW.value = 'true') then
        PERFORM update_map_pools();
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS taiu_settings ON public.settings;
CREATE TRIGGER taiu_settings AFTER UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.taiu_settings();
