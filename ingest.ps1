while ($true) {
  Write-Output "Starting ingest at $(Get-Date)"
    try {
    Invoke-WebRequest -Uri http://localhost:3001/ingest/run -Method POST
    } catch {
    Write-Output "Ingest failed at $(Get-Date)"
    }
    Write-Output "Finished ingest at $(Get-Date)"
    Start-Sleep -Seconds 600
}