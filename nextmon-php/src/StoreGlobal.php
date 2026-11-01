<?php
/**
 * Explicit handle on one GLOBAL collection (users, workspaces, shares, platform, indexes...). Obtained with Store::global($name);
 * works with or without an active workspace. Same verbs as Store, bound to one name.
 */
final class StoreGlobal
{
    private string $name;

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function read($default = [])
    {
        return Store::read($this->name, $default);
    }

    public function write($data): void
    {
        Store::write($this->name, $data);
    }

    public function update(callable $fn, $default = [])
    {
        return Store::update($this->name, $fn, $default);
    }

    public function append(array $row): void
    {
        Store::append($this->name, $row);
    }

    public function rows(int $limit = 100, int $offset = 0, array $where = []): array
    {
        return Store::rows($this->name, $limit, $offset, $where);
    }

    public function count(): int
    {
        return Store::count($this->name);
    }

    public function prune(int $keep): int
    {
        return Store::prune($this->name, $keep);
    }

    public function has(): bool
    {
        return Store::has($this->name);
    }

    public function delete(): void
    {
        Store::delete($this->name);
    }
}
