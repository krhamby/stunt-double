import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { App } from '../App';

// The whole app: both probe sections in one story.
const meta = { title: 'App/Page', component: App } satisfies Meta<typeof App>;
export default meta;

export const Page: StoryObj<typeof meta> = {};
