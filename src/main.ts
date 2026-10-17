import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource-variable/overpass';
import '@fontsource/overpass-mono/400.css';
import './app.css';

export default mount(App, { target: document.getElementById('app')! });
