import type { Meta, StoryObj } from '@storybook/react-vite';
import { App } from './App';

// The shared app as a story: the app-level <Button> and the SDK's <Checkout> render with the stunt doubles.
const meta = { title: 'App', component: App } satisfies Meta<typeof App>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
