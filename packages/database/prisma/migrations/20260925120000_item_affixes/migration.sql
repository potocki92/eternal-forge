ALTER TABLE "item_instances" ADD COLUMN "generation_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_generation_version_check" CHECK ("generation_version" >= 0);

CREATE TABLE "item_affix_rolls" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_instance_id" UUID NOT NULL,
  "affix_definition_id" VARCHAR(64) NOT NULL,
  "stat" VARCHAR(32) NOT NULL,
  "operation" VARCHAR(24) NOT NULL,
  "value" VARCHAR(64) NOT NULL,
  "generation_version" INTEGER NOT NULL,
  "position" SMALLINT NOT NULL,
  CONSTRAINT "item_affix_rolls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_affix_rolls_generation_version_check" CHECK ("generation_version" > 0),
  CONSTRAINT "item_affix_rolls_position_check" CHECK ("position" >= 0),
  CONSTRAINT "item_affix_rolls_stat_check" CHECK ("stat" IN ('MAX_HEALTH','DAMAGE','ATTACK_SPEED','CRITICAL_CHANCE','CRITICAL_DAMAGE')),
  CONSTRAINT "item_affix_rolls_operation_check" CHECK ("operation" IN ('FLAT','ADDITIVE_PERCENT')),
  CONSTRAINT "item_affix_rolls_value_check" CHECK ("value" ~ '^(?:0|[1-9][0-9]*|[1-9](?:\.[0-9]{1,17})?e(?:0|-?[1-9][0-9]*))$'),
  CONSTRAINT "item_affix_rolls_item_instance_id_fkey" FOREIGN KEY ("item_instance_id") REFERENCES "item_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "item_affix_rolls_item_position_key" ON "item_affix_rolls"("item_instance_id", "position");
CREATE UNIQUE INDEX "item_affix_rolls_item_definition_key" ON "item_affix_rolls"("item_instance_id", "affix_definition_id");
CREATE INDEX "item_affix_rolls_order_idx" ON "item_affix_rolls"("item_instance_id", "position");
ALTER TABLE "item_affix_rolls" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "item_affix_rolls" FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
