$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$contracts = Join-Path $root "contracts"
$backend = Join-Path $root "backend"
$audit = Join-Path $root "audit-service"
$frontend = Join-Path $root "frontend"

function Wait-ForPort([int]$port, [string]$name, [int]$timeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect("127.0.0.1", $port)
            Write-Host "$name is up on port $port"
            return
        }
        catch { Start-Sleep -Milliseconds 500 }
        finally { $client.Dispose() }
    }
    throw "$name did not come up on port $port within $timeoutSeconds seconds"
}

# 1) Kill an old Hardhat node still listening on 8545 (only the listener - not
#    processes that merely have a client connection to it). A listening socket has
#    RemotePort 0; matching on that rather than the State column, which some Windows
#    builds don't report as Listen/LISTENING.
$listenerPids = Get-NetTCPConnection -LocalPort 8545 -ErrorAction SilentlyContinue |
    Where-Object { $_.RemotePort -eq 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($hardhatPid in $listenerPids) {
    Write-Host "Killing old Hardhat node on port 8545 (PID $hardhatPid)"
    Stop-Process -Id $hardhatPid -Force
}

# 2) Start blockchain. The Hardhat node is in-memory: every restart is a fresh chain,
#    so records anchored in an earlier session will no longer verify on-chain.
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$contracts'; npm run node"
Wait-ForPort 8545 "Hardhat node"

# 3) Deploy contract (deterministic address on a fresh node - matches CONTRACT_ADDRESS in the .env files)
Push-Location $contracts
try { npx hardhat run scripts/deploy.ts --network localhost; if ($LASTEXITCODE -ne 0) { throw "Contract deploy failed" } }
finally { Pop-Location }

# 4) Start embedded Postgres
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backend'; npm run db:start"
Wait-ForPort 5433 "Postgres"

# 5) Apply existing migrations (deploy, not dev - dev can generate new migrations or prompt to reset the DB)
Push-Location $backend
try { npx prisma migrate deploy; if ($LASTEXITCODE -ne 0) { throw "Prisma migrate failed" } }
finally { Pop-Location }

# 6) Start backend, audit service, frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backend'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$audit'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontend'; npm run dev"

Write-Host ""
Write-Host "Project started."
Write-Host "Frontend: http://localhost:5173"
Write-Host "Backend: http://localhost:4000"
Write-Host "Audit service: http://localhost:4100"
Write-Host "Blockchain: http://127.0.0.1:8545"
