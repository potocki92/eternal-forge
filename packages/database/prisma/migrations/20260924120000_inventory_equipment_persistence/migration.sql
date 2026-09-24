CREATE TABLE "item_instances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "character_id" UUID NOT NULL,
  "definition_id" VARCHAR(64) NOT NULL,
  "rarity" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_instances_definition_id_check" CHECK ("definition_id" ~ '^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$'),
  CONSTRAINT "item_instances_rarity_check" CHECK ("rarity" IN ('COMMON','MAGIC','RARE','EPIC','LEGENDARY','MYTHIC')),
  CONSTRAINT "item_instances_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "item_instances_id_character_id_key" UNIQUE ("id", "character_id")
);
CREATE INDEX "item_instances_inventory_order_idx" ON "item_instances"("character_id", "created_at", "id");

CREATE TABLE "character_equipment" (
  "character_id" UUID NOT NULL,
  "slot" VARCHAR(16) NOT NULL,
  "item_instance_id" UUID NOT NULL,
  CONSTRAINT "character_equipment_pkey" PRIMARY KEY ("character_id", "slot"),
  CONSTRAINT "character_equipment_item_instance_id_key" UNIQUE ("item_instance_id"),
  CONSTRAINT "character_equipment_item_character_key" UNIQUE ("item_instance_id", "character_id"),
  CONSTRAINT "character_equipment_slot_check" CHECK ("slot" IN ('WEAPON','HELMET','CHEST','GLOVES','BOOTS','RING','AMULET')),
  CONSTRAINT "character_equipment_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "character_equipment_item_owner_fkey" FOREIGN KEY ("item_instance_id", "character_id") REFERENCES "item_instances"("id", "character_id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "item_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "character_equipment" ENABLE ROW LEVEL SECURITY;

-- Supabase defines these browser-facing roles, while plain PostgreSQL used by
-- local development and CI does not. Keep the migration portable without
-- weakening Supabase: revoke each fixed role only when PostgreSQL reports that
-- it exists. `%I` quotes the identifier rather than interpolating SQL text.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format(
                'REVOKE ALL ON TABLE "item_instances", "character_equipment" FROM %I',
                api_role
            );
        END IF;
    END LOOP;
END
$$;
