with open('scripts/inspect-instance.ts', 'r') as f:
    code = f.read()

code = code.replace(
  'const report = {',
  'const report = {\n    schemaVersion: 1,'
)

with open('scripts/inspect-instance.ts', 'w') as f:
    f.write(code)
