<?php
/**
 * Common contract for anything that can answer RouterOS-style calls:
 * the real API client (RouterOS) and the in-memory mock (Demo).
 * Paths look like "/ip/hotspot/user" (spaces are accepted too).
 */
interface Driver
{
    /** List rows. $query = equality filters (AND), $props = limit returned fields. */
    public function print(string $path, array $query = [], array $props = []): array;

    /** Add a row, returns the new .id */
    public function add(string $path, array $attrs): string;

    /** Update the row with .id (or name) = $id */
    public function set(string $path, string $id, array $attrs): void;

    /** Remove the row with .id = $id */
    public function remove(string $path, string $id): void;

    /** Run any other command, e.g. /tool/ping, /system/backup/save */
    public function command(string $path, array $attrs = [], array $query = []): array;

    public function isDemo(): bool;
}

class RouterOSException extends RuntimeException
{
}
