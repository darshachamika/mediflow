param(
    [Parameter(Mandatory)][string]$Container,
    [string]$Database = 'mediflow',
    [string]$DatabaseUser = 'mediflow',
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/..").Path
$target = [IO.Path]::GetFullPath($Output)
if (!$target.StartsWith((Join-Path $root 'artifacts/eta') + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose an output file beneath artifacts/eta to keep training exports ignored by Git.'
}
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
$query = (Get-Content "$root/tools/eta-ml-experiment/export.sql" -Raw).Trim().TrimEnd(';')
$csv = "COPY ($query) TO STDOUT WITH CSV HEADER;" |
    docker exec -i $Container psql -X -U $DatabaseUser -d $Database -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Read-only training export failed.' }
$csv | Set-Content -LiteralPath $target -Encoding utf8NoBOM
"Exported $([Math]::Max(0, $csv.Count - 1)) anonymous observations to $target"
