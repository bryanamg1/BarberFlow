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

## Shared form inputs

BF-031 adds `Input`, `PasswordInput` and `SearchInput` to `@/components/ui`, with their public prop types. They reuse the approved theme and loaded Inter faces. Placeholder routes remain unchanged.

- `Input` accepts standard React Native `TextInput` props, plus `label`, `error`, `helperText`, `disabled`, `containerStyle` and an optional `trailingAccessory`. Provide a visible `label` or an `accessibilityLabel` when omitting the label. `style` customizes the text field; `containerStyle` customizes its outer container. The minimum field height remains 48 logical pixels. Controlled `value`/`onChangeText` and uncontrolled `defaultValue` are supported; focus/blur callbacks are composed with the internal focus state.
- `PasswordInput` starts masked and adds a labeled Mostrar/Ocultar button. It preserves the value while toggling visibility and restores field focus. It uses a single-line text keyboard without capitalization, correction or spell checking. `autoComplete` defaults to `current-password`; future account creation screens can pass `new-password`.
- `SearchInput` requires controlled `value` and `onChangeText`. It requests the search keyboard action and shows a Limpiar button for nonempty values. Clearing calls `onChangeText('')` once and restores focus. `onSubmitEditing` is forwarded; search execution, filtering and debounce belong to future consumers.

Password and search labels default to Contraseña and Buscar. Pass a custom `label`, or only `accessibilityLabel` to omit the visible label. All three accept a React 19 `ref` to the actual native/Web `TextInput`, allowing focus and other standard field methods. In controlled fields, update the owning value to clear the text.

Errors replace helper text, use the approved danger border and include a visible Error prefix. Web associates labels/messages through IDs and `aria-describedby`, exposes `aria-invalid` and uses the DOM disabled state. Native accessibility hints include the message. Disabled, `readOnly` and `editable={false}` fields block changes and their accessory actions; read-only fields remain focusable. Focus uses the approved primary border and Web outline color. Text keeps system scaling and multiline is supported by `Input`.

```tsx
import { useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { Input, PasswordInput, SearchInput } from '@/components/ui';

function FieldsExample() {
  const inputRef = useRef<TextInput>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [search, setSearch] = useState('');

  return (
    <>
      <Input ref={inputRef} label="Nombre" value={name} onChangeText={setName} />
      <PasswordInput value={password} onChangeText={setPassword} />
      <SearchInput value={search} onChangeText={setSearch} />
    </>
  );
}
```

Run `node --test tests/ui-primitives.test.cjs` for the shared UI checks, including input states, accessory actions, refs and real React Native Web rendering. No form library, feature validation or business behavior is added. The input contracts follow [React Native TextInput](https://reactnative.dev/docs/0.86/textinput) and [React Native Web TextInput](https://necolas.github.io/react-native-web/docs/text-input/).

## Shared feedback states

BF-032 exports `LoadingState`, `EmptyState`, `ErrorState` and `Skeleton` and their prop types from `@/components/ui`. They use existing theme tokens and Inter. Consumers own which state appears, requests and retry status; these components do not fetch data or change navigation.

- `LoadingState` centers an ActivityIndicator and a message, defaulting to Cargando…. Pass `message=""` for a spinner without visible text; it retains the accessible name Cargando…. The state exposes a named, busy, indeterminate progress bar, while its decorative spinner is hidden from assistive tools. No percentage is fabricated.
- `EmptyState` accepts `title` (default Sin resultados), optional `message` and optional `action: { label, onPress, disabled?, loading?, accessibilityLabel? }`. Its text forms a polite status region. The existing Button is a separate accessibility target outside that group.
- `ErrorState` accepts `title` (default Ocurrió un error), optional user-facing `message` and `onRetry`. A retry button appears only when `onRetry` exists. `retryLabel` defaults to Reintentar; `retrying` and `retryDisabled` delegate blocking to Button. The message forms an assertive alert; its button remains independently accessible. Pass friendly presentation text, never a raw SQL/Supabase error.
- `Skeleton` renders one static decorative block, hidden from screen readers and unable to intercept touches. Its default width fills the container, height uses `theme.spacing[24]` and radius uses the `8` radius token. `width`/`height` accept standard native dimensions, and `radius` selects an existing theme radius key. Use theme tokens for custom dimensions/styles; compose multiple blocks in the consumer. A parent LoadingState can describe their loading status. No shimmer, pulse or animation tokens are introduced.

All four accept `style` and `testID`. State containers center their contents with token padding/gaps; use `style={{ flex: 1 }}` when their parent should give them the full available section/page height. Text remains scalable and wraps without line limits. The danger-colored error title uses the approved `headingLg` scale, retaining large-text contrast even on `surfaceStrong`. Placeholder routes are unchanged.

```tsx
import { EmptyState, ErrorState, LoadingState, Skeleton } from '@/components/ui';
import { theme } from '@/theme';

<LoadingState message="Cargando información…" />;
<EmptyState title="Sin resultados" message="Prueba otra búsqueda." />;
<ErrorState
  message="No pudimos cargar la información."
  onRetry={handleRetry}
  retrying={retrying}
/>;
<Skeleton height={theme.spacing[40]} radius="card" />;
```

The existing `node --test tests/ui-primitives.test.cjs` suite covers state names, busy semantics, actions, blocked retries, decorative skeletons and real Web markup, along with previous UI contracts. Follow [React Native accessibility](https://reactnative.dev/docs/0.86/accessibility) and [ActivityIndicator](https://reactnative.dev/docs/0.86/activityindicator) for the underlying platform semantics.

## Shared overlays

BF-033 exports `Modal`, `BottomSheet` and their prop types from `@/components/ui`. Both wrap the existing React Native Modal and use theme tokens, Inter and the existing Button. No dependencies, theme values or placeholder routes are added.

Both accept controlled `visible` and `onClose`, optional `title`, `description`, `children` and `actions`, plus `dismissible`, `accessibilityLabel`, `closeLabel`, `style` and `testID`. The owner updates `visible` when closing. `dismissible` defaults to true: the Cerrar button, backdrop, Android Back, native accessibility escape and Web Escape request closure. With `dismissible={false}`, those requests are blocked and the close button is omitted; provide an explicit action to update the owning state. Clicking content does not dismiss an overlay.

The native modal isolates the presentation; React Native Web supplies its dialog semantics, focus containment, Escape handling and focus restoration. The title names the Web dialog and its description is associated through ARIA; use `accessibilityLabel` when omitting a title or to override its accessible name. Content and action controls stay individually accessible. Background body scrolling is locked on Web, including nested overlays, and restored when the last overlay closes. Overlays render nothing while closed or during Web server rendering.

`Modal` centers its panel within the safe area. `BottomSheet` anchors its panel to the bottom and includes the bottom safe inset inside its surface. Native panels fill the available width; Web panels use their content width, bounded by the viewport. Both retain the approved card radius and floating shadow. Long content and actions share an internal scroll area, with keyboard avoidance on native and handled keyboard taps. Pass theme-based styles when a consumer needs a particular width or layout. This base BottomSheet has no drag gestures or snap points; it opens and closes through controlled visibility without animation.

```tsx
import { useState } from 'react';
import { Button, Modal } from '@/components/ui';

function OverlayExample() {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Button label="Abrir" onPress={() => setVisible(true)} />
      <Modal
        visible={visible}
        onClose={() => setVisible(false)}
        title="Información"
        description="Contenido del panel."
        actions={<Button label="Cerrar" onPress={() => setVisible(false)} />}
      />
    </>
  );
}
```

The shared UI suite covers both overlays on iOS, Android and Web, including closure guards, naming, safe area, keyboard and server rendering contracts. Browser checks additionally cover Tab cycling, focus restoration, nested overlays and scrolling. Native bundling verifies module compatibility; VoiceOver, TalkBack and software keyboard behavior still require device testing. Underlying contracts follow [React Native Modal](https://reactnative.dev/docs/0.86/modal), [React Native Web Modal](https://necolas.github.io/react-native-web/docs/modal/) and [Expo SDK 57 safe area context](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/).
