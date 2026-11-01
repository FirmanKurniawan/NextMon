<?php
/**
 * Contract for a payment gateway adapter (shop module).
 * Adapters are flat files src/Payment<Name>.php and are registered in Payments::CLASSES.
 */
class PaymentException extends RuntimeException
{
}

interface PaymentGateway
{
    public function id(): string;

    public function label(): string;

    /** @return array<int,array{key:string,label:string,secret?:bool,help?:string}> credential fields shown on /shop/settings */
    public function fields(): array;

    /** true when the gateway reports payment by webhook (everything except manual transfer) */
    public function hasWebhook(): bool;

    /**
     * Create the remote payment. $order = our order row (amount is already computed server-side),
     * $cfg = decrypted credentials + 'env' (sandbox|production),
     * $ctx = return_url, callback_url, expiry_min, item_name.
     * @return array{ref:string,pay_url:string,info:string}
     * @throws PaymentException
     */
    public function create(array $order, array $cfg, array $ctx): array;

    /** Cheap sniff: does this webhook look like it came from this gateway? (headers are lower-cased) */
    public function detect(array $headers, string $raw): bool;

    /**
     * Verify the webhook authenticity (signature/token) and normalise it.
     * @return array{order_id:string,status:string,amount:int,ref:string} status = paid|pending|failed|expired|refunded
     * @throws PaymentException when the signature/token is missing or wrong
     */
    public function parseCallback(array $headers, string $raw, array $cfg): array;
}
