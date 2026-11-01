<?php
/** Thrown when per-workspace data is touched while no workspace is active (fail closed: never fall back to another tenant's data). */
class NoWorkspaceException extends RuntimeException
{
}
