CREATE TABLE enquiry_resumes (
    enquiry_id uuid PRIMARY KEY REFERENCES enquiries (id) ON DELETE CASCADE,
    filename text NOT NULL CHECK (filename ~ '^[A-Za-z0-9_-]{1,100}[.]pdf$'),
    data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152)
);
