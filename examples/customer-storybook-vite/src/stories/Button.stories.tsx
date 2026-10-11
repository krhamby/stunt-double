import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@acme/core';

// The app-level Button: imported from the SDK barrel, rendered as the project's override (BRAND_BUTTON).
const meta = {
  title: 'App/Button',
  component: Button,
  decorators: [(Story) => <section data-probe="app"><Story /></section>],
  args: { variant: 'primary', children: 'Sign in' },
} satisfies Meta<typeof Button>;
export default meta;

export const Primary: StoryObj<typeof meta> = {};
