<?php
/** Thrown when a batch would exceed the workspace's daily voucher limit. */
class QuotaException extends RuntimeException
{
    public int $used = 0;
    public int $limit = 0;
    public int $requested = 0;
}
