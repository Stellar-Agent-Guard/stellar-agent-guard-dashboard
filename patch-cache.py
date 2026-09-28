with open('lib/guard/bytecodeCache.ts', 'r') as f:
    code = f.read()

code = code.replace("delete store[keys[0]];", "delete store[keys[0] as string];")

with open('lib/guard/bytecodeCache.ts', 'w') as f:
    f.write(code)
