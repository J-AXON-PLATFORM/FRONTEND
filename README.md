# J-AXON Frontend

Aplicacion web de J-AXON con Next.js App Router, React y TypeScript. Implementa login humano, Inventory minimo y enrolamiento Agent hasta activacion SFTP.

La documentacion canonica general del proyecto vive en el directorio `doc/` del repositorio `BACKEND`.

## Requisitos

- Node.js 24.21.0
- npm 11.19.0

Con NVM:

```bash
nvm use
node --version
npm --version
```

Desactiva la telemetria de Next.js durante el desarrollo y la verificacion:

```bash
export NEXT_TELEMETRY_DISABLED=1
```

## Instalacion

Usa el lockfile para obtener una instalacion reproducible:

```bash
npm ci
```

## Comandos

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e:local
npm run build
npm run verify
npm run audit:production
npm run audit:dependencies
```

`verify` ejecuta lint, typecheck, pruebas y build en ese orden. `test:e2e:local` requiere Docker, uv y los repositorios candidatos `backend` y `automation-collector` en los directorios hermanos. Construye SFTPGo Local/Test, crea credenciales, PostgreSQL y estados Agent efimeros, ejecuta los tres candidatos y limpia solo sus recursos propios.

## Estructura

- `src/app/`: routing, layouts y composicion con App Router.
- `src/features/`: capacidades de usuario o negocio cuando sean autorizadas.

Los Server Components son el valor por defecto. Un componente solo debe usar `"use client"` cuando necesite interactividad o APIs del navegador.

La aplicacion es no-indexable. No deben almacenarse secretos en variables `NEXT_PUBLIC_*` ni en el navegador.

TanStack Query mantiene la sesion recuperada solo en memoria. La cookie `HttpOnly` no es accesible desde JavaScript y el CSRF no se escribe en `localStorage`, `sessionStorage` o IndexedDB. `NEXT_PUBLIC_JAXON_API_URL` contiene solo la URL publica del backend, nunca secretos.

## Seguridad de dependencias

La auditoria de produccion es bloqueante y debe permanecer limpia. La auditoria completa aplica una excepcion temporal aprobada por LUIS el 2026-10-08 exclusivamente para `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687` en `braces@3.0.3`.

La dependencia es transitiva y solo de desarrollo:

```text
eslint-config-next
`-- @next/eslint-plugin-next
    `-- fast-glob
        `-- micromatch
            `-- braces@3.0.3
```

No existe una version oficial corregida al registrar esta excepcion y el paquete no participa en el arbol de produccion ni procesa datos de usuarios de J-AXON. `npm run audit:dependencies` valida la cadena, version, alcance de desarrollo, ausencia en produccion y resultado JSON completo de npm. Falla ante cualquier advisory o condicion distinta.

La excepcion debe eliminarse cuando exista una version oficial corregida, cuando la cadena deje de incluir `braces` o cuando la herramienta que lo introduce sea sustituida mediante una decision posterior aprobada. No autoriza otras vulnerabilidades, forks, parches no oficiales ni flags de evasion.

ESLint 9.39.5 se usa temporalmente porque los plugins transitivos de `eslint-config-next@16.3.8` fallan de forma ejecutable con ESLint 10.12.0. ESLint 9 esta EOL; debe actualizarse a una linea mantenida cuando la cadena oficial de Next.js sea compatible y todas las verificaciones permanezcan verdes.
