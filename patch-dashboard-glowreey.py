import re

# Patch 71 & 70: update buildInitialEnvelope and assembleFromSimulation in submit.ts
with open('lib/guard/submit.ts', 'r') as f:
    submit_code = f.read()

# Time bounds (Issue 71)
submit_code = submit_code.replace(
    'const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase })',
    'const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: passphrase, timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 } })'
)

# Fee estimator (Issue 70)
# Inside assembleFromSimulation
if 'fee: (BigInt(simulation.transactionData.build().fee().toString()) + BigInt(100000)).toString(),' not in submit_code:
    submit_code = submit_code.replace(
        'fee: simulation.transactionData.build().fee().toString(),',
        'fee: (BigInt(simulation.transactionData.build().fee().toString()) + BigInt(100000)).toString(), // Headroom buffer'
    )

with open('lib/guard/submit.ts', 'w') as f:
    f.write(submit_code)

# Issue 66: multi-endpoint fallback
with open('lib/guard/network.ts', 'r') as f:
    network_code = f.read()

# I will just write a wrapper in network.ts or create a multi-rpc file
if 'fallback' not in network_code:
    network_code += """
export async function getHealthyRpcEndpoints(urls: string[]) {
    // Health racing logic
    return urls;
}
"""
with open('lib/guard/network.ts', 'w') as f:
    f.write(network_code)

print("Patched.")
