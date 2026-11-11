-- Phase 2: managed product catalogue (drafts, published versions, images, revisions).

CREATE TABLE app_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES admin_users (id)
);
-- The public site keeps using its original pages until the owner switches the managed catalogue on.
INSERT INTO app_settings (key, value) VALUES ('catalogue_live', 'false'), ('catalogue_version', '0');

CREATE TABLE listing_tabs (
    listing_page  text NOT NULL CHECK (listing_page IN ('chemicals', 'nonchemical')),
    key           text NOT NULL,
    label         text NOT NULL,
    display_order integer NOT NULL,
    PRIMARY KEY (listing_page, key)
);
INSERT INTO listing_tabs (listing_page, key, label, display_order) VALUES
    ('chemicals', 'herbicide', 'Herbicide', 1),
    ('chemicals', 'insecticide', 'Insecticide', 2),
    ('chemicals', 'fungicide', 'Fungicide', 3),
    ('chemicals', 'fertilizer', 'Fertilizer', 4),
    ('nonchemical', 'pgpr', 'PGPR', 1),
    ('nonchemical', 'biofertilizer', 'Biofertilizer', 2),
    ('nonchemical', 'biofungicide', 'Biofungicide', 3),
    ('nonchemical', 'biolarvicide', 'Biolarvicide', 4),
    ('nonchemical', 'bioinsecticide', 'Bioinsecticide', 5);

-- Uploaded and replacement images. Existing images stay in products/ and are not stored here.
CREATE TABLE product_images (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    data          bytea NOT NULL,
    bytes         integer NOT NULL,
    width         integer NOT NULL,
    height        integer NOT NULL,
    sha256        text NOT NULL,
    original_name text,
    created_by    uuid REFERENCES admin_users (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalogue        text NOT NULL CHECK (catalogue IN ('chemical', 'nonchemical')),
    product_id       text NOT NULL CHECK (product_id ~ '^[a-z0-9][a-z0-9 -]{0,79}$'),
    status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    published        jsonb,
    draft            jsonb,
    version          integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid REFERENCES admin_users (id),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       uuid REFERENCES admin_users (id),
    published_at     timestamptz,
    published_by     uuid REFERENCES admin_users (id),
    archived_at      timestamptz,
    archived_by      uuid REFERENCES admin_users (id),
    -- Set by the import when the source data is ambiguous; cleared when the owner decides.
    needs_decision   boolean NOT NULL DEFAULT false,
    import_notes     jsonb NOT NULL DEFAULT '[]',
    import_alternate jsonb,
    UNIQUE (catalogue, product_id),
    CHECK (status <> 'published' OR published IS NOT NULL),
    CHECK (published IS NOT NULL OR draft IS NOT NULL)
);
CREATE INDEX products_status_idx ON products (status);

CREATE TABLE product_revisions (
    id          bigserial PRIMARY KEY,
    product_id  uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    revision_no integer NOT NULL,
    action      text NOT NULL,
    content     jsonb NOT NULL,
    actor_id    uuid REFERENCES admin_users (id),
    at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_id, revision_no)
);
