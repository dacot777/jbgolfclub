ALTER TABLE inquiries ADD COLUMN customer_type TEXT CHECK(customer_type IN ('junior','adult'));
