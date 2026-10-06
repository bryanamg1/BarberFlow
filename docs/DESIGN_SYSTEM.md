# BarberFlow — Design System

Version: 1.0  
Status: APPROVED

## Direction

Premium dark barber-shop identity with modern cyan technology cues and restrained warm gold accent. Avoid generic light SaaS, excessive neon and heavy neumorphism.

## Colors

```ts
export const colors = {
  background: '#071116',
  surface: '#0C171D',
  surfaceRaised: '#101E25',
  surfaceStrong: '#15262E',
  primary: '#17E5E5',
  primaryPressed: '#0FC1C6',
  primaryMuted: '#12383D',
  accent: '#F1A23A',
  accentMuted: '#3E2D1B',
  textPrimary: '#F4F7F8',
  textSecondary: '#97A5AD',
  textMuted: '#65737B',
  border: '#1C3038',
  borderStrong: '#28515A',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(0,0,0,0.65)',
}
```

## Typography

Font: Inter. Tokens: displayLg 32/38/700, display 28/34/700, headingLg 24/30/700, heading 20/26/600, headingSm 18/24/600, bodyLg 16/24/400, body 14/21/400, bodyMedium 14/21/500, caption 12/18/400.

## Spacing

4, 8, 12, 16, 20, 24, 32, 40. Avoid arbitrary values without reason.

## Radius

8, 12, 16, 20, 24, pill 999. Suggested cards 16, inputs 12, buttons 12.

## Interaction

Border widths: `borderWidths.thin = 1` logical pixel, shared by outlines, card/badge borders and dividers.

Minimum touch target 44x44, preferred 48x48. FAB 56x56.

Button variants: Primary, Secondary, Outline, Danger, Ghost. States: default, pressed, disabled, loading.

Inputs: default, focused, filled, error, disabled. Focus uses primary border; error uses danger + helper text.

Glow is restrained and limited to FAB, selected date, primary CTA and important active state.

## Status

Appointments: PENDING warning, CONFIRMED primary, IN_PROGRESS accent, COMPLETED success, CANCELLED danger, NO_SHOW muted/danger. Always pair color with label/icon.

Stock: NORMAL neutral/success, LOW warning, OUT danger.

Finance: revenue primary cyan, expense danger, positive result success.

## Navigation

Bottom tabs: Inicio, Agenda, center +, Clientes, Finanzas. Active primary; inactive muted. Quick Action Sheet: Nuevo turno, Nuevo cliente, Nueva venta, Nuevo gasto, Ingresar mercadería.

## Responsive web

Use max-width content, KPI grids, wider charts and multi-column layouts. Do not simply stretch mobile screens.
