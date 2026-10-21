-- Product edits captured during a stock count.
--
-- Lets staff correct a scanned product's name, set a new sell price and
-- leave a note, and fill in details for barcodes that didn't match the
-- catalogue so they can be added to Lightspeed. These feed the
-- "Product import CSV" export (Lightspeed Back Office -> Products -> Import).
--
-- Additive only and safe to run more than once.

-- Existing products scanned in a count
alter table stock_session_items
  add column if not exists new_name text,
  add column if not exists new_sell_price numeric(10, 2),
  add column if not exists notes text;

-- Barcodes that didn't match: details for creating the product
alter table stock_session_unmatched
  add column if not exists product_name text,
  add column if not exists sell_price numeric(10, 2),
  add column if not exists cost_price numeric(10, 4),
  add column if not exists category text,
  add column if not exists container text,
  add column if not exists size_ml numeric(10, 2),
  add column if not exists quantity numeric(10, 3);

alter table stock_session_unmatched
  drop constraint if exists stock_session_unmatched_container_check;
alter table stock_session_unmatched
  add constraint stock_session_unmatched_container_check
  check (container is null or container in
    ('UNIT', 'CAN', 'BOTTLE', 'BAG', 'PACKET', 'TUB', 'KEG', 'CONTAINER'));
