param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9-]{3,80}$')]
  [string]$SpriteName,

  [string]$PolicyPath = (Join-Path $PSScriptRoot '..\..\sandbox\sprites\network-policy.json'),
  [string]$ApiBase = 'https://api.sprites.dev/v1'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:SPRITES_TOKEN)) {
  throw 'SPRITES_TOKEN is missing. Set it in this PowerShell session only; never paste it into chat or save it in the repository.'
}

$resolvedPolicy = (Resolve-Path -LiteralPath $PolicyPath).Path
$policyJson = Get-Content -LiteralPath $resolvedPolicy -Raw
$policy = $policyJson | ConvertFrom-Json

if (-not $policy.rules -or -not ($policy.rules | Where-Object { $_.domain -eq '*' -and $_.action -eq 'deny' })) {
  throw 'The policy must contain a global deny rule.'
}

$encodedName = [uri]::EscapeDataString($SpriteName)
$uri = "$ApiBase/sprites/$encodedName/policy/network"
$headers = @{ Authorization = "Bearer $($env:SPRITES_TOKEN)" }

Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json' -Body $policyJson | Out-Null
$applied = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers

$expected = @($policy.rules | ForEach-Object { "$($_.domain)|$($_.action)|$($_.include)" })
$actual = @($applied.rules | ForEach-Object { "$($_.domain)|$($_.action)|$($_.include)" })
if ($expected.Count -ne $actual.Count -or (Compare-Object -ReferenceObject $expected -DifferenceObject $actual)) {
  throw 'Sprites returned a network policy that does not exactly match the repository policy.'
}

Write-Host "Verified deny-by-default network policy on $SpriteName." -ForegroundColor Green
Write-Host 'Allowed: GitHub and npm domains only. Everything else is denied.'
