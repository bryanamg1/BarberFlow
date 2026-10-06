# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- Run `npm run format` to apply the project's Prettier formatting and `npm run format:check` to verify it without changing files.
  `.prettierrc.json` defines the style. `.prettierignore` excludes generated output, the npm lockfile, approved reference documentation, imported assets and generated agent instructions.
- Run `npm run lint` to check source code with `eslint.config.js`, based on `eslint-config-expo/flat`.
  Prettier's recommended ESLint integration checks formatting and disables conflicting style rules. Generated `dist/`, `node_modules/` and `.expo/` files are ignored. See the [Expo ESLint and Prettier guide](https://docs.expo.dev/guides/using-eslint/) for supported configuration.
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Import aliases

BarberFlow configures import aliases in `compilerOptions.paths` in `tsconfig.json`:

| Alias        | Location                                                            |
| ------------ | ------------------------------------------------------------------- |
| `@/*`        | `src/*`                                                             |
| `@/assets/*` | `assets/*` at the project root, retained for existing image imports |

The `paths` values use `./src/*` and `./assets/*`: TypeScript requires the leading `./` when `baseUrl` is absent.

Use `@/` for imports across source directories. For example, this imports the theme tokens:

```tsx
import { theme } from '@/theme';
```

Short imports between sibling files may remain relative. Routes stay in `src/app/`; components, hooks and future domain code stay outside that directory. The same `@/*` mapping will cover future source folders when their tickets create them.

[Expo resolves these aliases natively in Metro](https://docs.expo.dev/guides/typescript/#path-aliases-optional). Restart Expo CLI after changing `paths`. No Babel alias plugin or custom Metro configuration is needed.

Keep `extends: "expo/tsconfig.base"` and `strict: true`. `baseUrl` is omitted because aliases resolve relative to `tsconfig.json` without it and [TypeScript 6 deprecates that option](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html#deprecated---baseurl).

## Public environment configuration

Copy `.env.example` to `.env.local` and fill in the two approved variables:

| Variable                        | Requirement                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | A valid HTTP or HTTPS URL; localhost is supported for local development   |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The project's public anon key, with at least one non-whitespace character |

[Expo loads and inlines public variables natively](https://docs.expo.dev/guides/environment-variables/). Local `.env` files are ignored by Git; `.env.example` contains no credentials and is tracked. Never put private or service-role keys in `EXPO_PUBLIC_*` variables: these values are visible in the compiled app.

Application code must import `env` from `@/lib/env` rather than reading these variables directly. `src/lib/env.ts` uses static `process.env.EXPO_PUBLIC_*` property access and Zod validation. Importing the module validates both values, trims surrounding whitespace and exports a typed, read-only object with `env.supabaseUrl` and `env.supabaseAnonKey`. Missing or invalid values cause a configuration error that lists only variable names, never values.

The Supabase client consumes this validated configuration when imported. The current placeholder screens can still run without local Supabase configuration because they do not import the client yet. After editing `.env.local`, fully reload the app through Expo to pick up the updated values. This validation checks configuration syntax; it does not verify that a project or key exists or make network requests.

## Shared Supabase client

Import the single client instance from `@/lib/supabase/client`:

```ts
import { supabase } from '@/lib/supabase/client';
```

Future repositories must reuse this instance rather than call `createClient` themselves. The client uses the existing public anon key; the approved environment variable names remain unchanged.

Session storage follows the [official Supabase Expo quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native): `expo-sqlite/localStorage/install` supplies persistent local storage on iOS and Android, while Web uses the browser's own `localStorage`. The [Expo SDK 57 SQLite documentation](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#the-localstorage-api) confirms the installer does nothing on Web. `storage.native.ts` loads it only for native platforms; `storage.ts` uses browser storage. This split also avoids Metro resolving SQLite's WASM assets in Web development, without custom Metro configuration. During Web static rendering, where `localStorage` is absent, the client safely uses Supabase's in-memory fallback. It is an application client, not a server-side authentication client for handling user requests.

The URL polyfill loads before client creation. Session persistence and automatic token refresh are enabled; automatic session detection from URLs is disabled. BF-016 configures the client only. Login, session bootstrap, routing guards, auth lifecycle handling and recovery links belong to later auth tickets.

## Theme tokens

`src/theme/` is the single source for BarberFlow's dark theme. Import `theme` or individual token groups from `@/theme`. Tokens contain the approved palette, semantic colors, nine text styles, spacing, radii, touch target sizes, border widths and platform-specific shadows. Tokens are read-only in TypeScript. They do not create components or change screen styling.

Spacing keys are the actual logical pixel values, such as `theme.spacing[16]`. Radius tokens include `card`, `input`, `button` and `pill`. Minimum touch targets are 44 x 44, preferred targets are 48 x 48, and FABs are 56 x 56.

Typography uses four registered Inter families through `fontFamilies`: `Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold` and `Inter_700Bold`. Each text style selects its actual static font face; it omits `fontWeight` to avoid synthetic weight selection. The exported `fontWeights` metadata and approved sizes/line heights are preserved. Theme tokens do not disable system text scaling.

The root layout loads these four bundled faces from `@expo-google-fonts/inter` using the existing `expo-font` dependency, following [Expo's runtime font-loading guide](https://docs.expo.dev/develop/user-interface/fonts/#with-usefonts-hook). Individual weight imports avoid bundling the package's unused faces. No external CDN, manually copied font files or additional native font plugin is needed.

Native startup keeps the splash screen visible until fonts finish loading. The root renders navigation once fonts are ready, or continues with system fallback fonts and a diagnostic warning if loading fails. Web static rendering registers the fonts for preload and generated `@font-face` rules; `FontDisplay.BLOCK` reduces fallback-font flashes while the browser fetches the local assets. The placeholder screens and navigation options are preserved; later UI components can apply `theme.typography` styles.

The design document specifies restrained elevation without numerical shadow values. `raised` and `floating` provide small defaults: iOS uses native shadow props, Android uses elevation (2 and 4), and Web uses CSS `boxShadow`. See the [React Native 0.86 shadow documentation](https://reactnative.dev/docs/0.86/shadow-props). `none` clears the corresponding shadow for each platform; colored glow is not applied automatically.

Semantic colors follow `docs/DESIGN_SYSTEM.md`. `NO_SHOW` uses the permitted muted color and normal stock uses success. Status UI must pair color with a label/icon. `textMuted` has approximately 3.90:1 contrast on `background`, below the [WCAG AA 4.5:1 minimum for normal text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Reserve it for inactive/decorative content or qualifying large text after checking its background; use `textSecondary` for readable secondary information. Primary action backgrounds should use the dark `background` color for text (12.15:1 contrast), rather than `textPrimary` (1.46:1). The approved palette remains unchanged.

The unused scaffold theme constants, color-scheme hooks and CSS font variables were removed so that consumers cannot accidentally import a second light/dark palette. Routing, environment configuration and the shared Supabase client are unchanged.

## Shared UI primitives

Import `Button`, `IconButton`, `Card`, `Badge` and `Divider` from `@/components/ui`. Their props/types are exported from the same module. `borderWidths.thin` is the approved 1 logical pixel token used by borders, focus indicators and dividers.

- `Button` requires `label` and supports `primary` (default), `secondary`, `outline`, `danger` and `ghost`. `loading` keeps the label visible, adds the native loading indicator and blocks presses; both native accessibility state and Web ARIA announce busy/disabled. Pressed danger inverts the existing danger/background colors to avoid inventing another shade.
- `IconButton` requires `accessibilityLabel` and an `icon` render function receiving `{ color, size }`. Compose an existing icon or other decorative node with those values; no icon/UI dependency is added. Its content is hidden from screen readers so only the button name is announced.
- `Card` is a static container accepting children and normal View props. It uses the raised surface, card radius, padding and restrained raised shadow; it does not group or hide interactive children.
- `Badge` requires a visible `label` and accepts a `tone`: `neutral` (default), `primary`, `accent`, `success`, `warning` or `danger`. Tones are presentation only; feature status mappings remain inside their features.
- `Divider` is a decorative horizontal rule, hidden from accessibility tools.

Buttons support normal Pressable events, style objects or style callbacks and caller focus/blur handlers. They preserve minimum 48 x 48 touch targets and show keyboard focus using theme borders and, on Web, an outline. Text remains scalable and can wrap; no fixed text height or line limit is imposed. Container styles and Button/Badge `textStyle` allow composition; callers must use theme tokens and preserve contrast. Disabled controls use the approved muted text; no opacity token is introduced. Static text styles use the Inter faces already loaded by the root layout.

```tsx
import { Text } from 'react-native';
import { Badge, Button, Card, Divider, IconButton } from '@/components/ui';
import { theme } from '@/theme';

<Card style={{ gap: theme.spacing[16] }}>
  <Badge label="Disponible" tone="success" />
  <Divider />
  <Button label="Continuar" onPress={handleContinue} />
  <IconButton
    accessibilityLabel="Agregar"
    onPress={handleAdd}
    icon={({ color, size }) => (
      <Text style={{ ...theme.typography.heading, color, fontSize: size }}>+</Text>
    )}
  />
</Card>;
```

BF-030 does not apply primitives to placeholder routes. No Inputs, feature components or additional state components are included. Run `node --test tests/ui-primitives.test.cjs` for the component behavior checks, in addition to lint, TypeScript and formatting checks. The interaction contracts follow [React Native Pressable](https://reactnative.dev/docs/0.86/pressable), [accessibility](https://reactnative.dev/docs/0.86/accessibility) and [React Native Web Pressable](https://necolas.github.io/react-native-web/docs/pressable/).
