<?php
/** Bank transfer / e-wallet by hand: customer sees the instructions, an admin confirms in /orders. */
final class PaymentManual implements PaymentGateway
{
    public function id(): string
    {
        return 'manual';
    }

    public function label(): string
    {
        return t('Manual transfer (admin confirms)');
    }

    public function fields(): array
    {
        return [];
    }

    public function hasWebhook(): bool
    {
        return false;
    }

    public function create(array $order, array $cfg, array $ctx): array
    {
        return ['ref' => $order['id'], 'pay_url' => '', 'info' => (string)($cfg['instructions'] ?? '')];
    }

    public function detect(array $headers, string $raw): bool
    {
        return false;
    }

    public function parseCallback(array $headers, string $raw, array $cfg): array
    {
        throw new PaymentException('Manual gateway has no webhook');
    }
}
