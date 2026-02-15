-- Replace transaction code with phone number for spot reservation
-- mpesa_transaction_code stays but becomes nullable; phone_number added to users

ALTER TABLE payments MODIFY mpesa_transaction_code VARCHAR(50) NULL;

ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL;
