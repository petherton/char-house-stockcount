-- Current Lightspeed sell price on each product, shown to staff when they
-- scan so they can check the shelf ticket matches.
--
-- The Insights stock feed doesn't carry price, so prices come from the
-- Lightspeed Back Office product export: whenever staff attach one in the
-- Product CSV dialog, refresh_product_prices() updates every matching
-- product for that venue.
--
-- Additive only and safe to run more than once.

alter table products
  add column if not exists sell_price numeric(10, 2),
  add column if not exists price_updated_at timestamptz;

-- prices: jsonb array of {"id": "<Lightspeed ProductID>", "barcode": "...", "price": "24.99"}
create or replace function refresh_product_prices(p_venue_id text, prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_authorized_staff() then
    raise exception 'not authorized';
  end if;

  with incoming as (
    select
      nullif(trim(x->>'id'), '') as ls_id,
      nullif(trim(x->>'barcode'), '') as barcode,
      (nullif(trim(x->>'price'), ''))::numeric(10, 2) as price
    from jsonb_array_elements(prices) as x
    where nullif(trim(x->>'price'), '') ~ '^-?[0-9]+(\.[0-9]+)?$'
  ),
  matched as (
    select distinct on (p.id) p.id, i.price
    from products p
    join incoming i
      on p.venue_id = p_venue_id
     and (p.lightspeed_product_id = i.ls_id or (i.barcode is not null and p.barcode = i.barcode))
    order by p.id, (p.lightspeed_product_id = i.ls_id) desc
  )
  update products p
     set sell_price = m.price,
         price_updated_at = now()
    from matched m
   where p.id = m.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function refresh_product_prices(text, jsonb) from public, anon;
grant execute on function refresh_product_prices(text, jsonb) to authenticated;
