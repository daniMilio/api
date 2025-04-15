CREATE OR REPLACE FUNCTION public.v_pool_maps_insert_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public._map_pool (map_pool_id, map_id)
  VALUES (NEW.map_pool_id, NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v_pool_maps_insert_trigger ON public.v_pool_maps;
CREATE TRIGGER v_pool_maps_insert_trigger
INSTEAD OF INSERT ON public.v_pool_maps
FOR EACH ROW
EXECUTE FUNCTION public.v_pool_maps_insert_trigger_function();

CREATE OR REPLACE FUNCTION public.v_pool_maps_update_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public._map_pool
  SET map_pool_id = NEW.map_pool_id,
      map_id = NEW.id
  WHERE map_pool_id = OLD.map_pool_id AND map_id = OLD.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v_pool_maps_update_trigger ON public.v_pool_maps;
CREATE TRIGGER v_pool_maps_update_trigger
INSTEAD OF UPDATE ON public.v_pool_maps
FOR EACH ROW
EXECUTE FUNCTION public.v_pool_maps_update_trigger_function();

CREATE OR REPLACE FUNCTION public.v_pool_maps_delete_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public._map_pool
  WHERE map_pool_id = OLD.map_pool_id AND map_id = OLD.id;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS v_pool_maps_delete_trigger ON public.v_pool_maps;
CREATE TRIGGER v_pool_maps_delete_trigger
INSTEAD OF DELETE ON public.v_pool_maps
FOR EACH ROW
EXECUTE FUNCTION public.v_pool_maps_delete_trigger_function(); 