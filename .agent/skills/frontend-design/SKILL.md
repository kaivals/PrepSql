# Frontend Design Best Practices & Guidelines

This document outlines the core principles, design aesthetics, and technical requirements for frontend development within this workspace. Agents and developers must adhere to these guidelines to ensure visually stunning, highly performant, accessible, and maintainable user interfaces.

---

## 1. Visual Aesthetics & Design System

Every frontend must look modern, premium, and visually engaging at first glance. Generic, plain, or "minimum viable" looks are unacceptable.

### A. Color Palette & Theming
*   **Avoid Generic Colors**: Do not use standard primary colors (e.g., pure `#FF0000` red, `#0000FF` blue, `#00FF00` green).
*   **Curated Palettes**: Use cohesive HSL-based colors, modern pastel highlights, or deep, rich dark modes.
*   **Contrast & Accents**: Establish a clear hierarchy using subtle neutral backgrounds (e.g., slate, zinc, or dark obsidian shades) accented with vibrant, high-contrast action colors.
*   **Dark Mode First**: Support sleek dark interfaces with soft glow effects, border borders (1px translucent lines), and depth-inducing shadows.

### B. Typography
*   **Custom Fonts**: Avoid default system fonts. Prefer modern typography sourced from Google Fonts (e.g., *Inter*, *Outfit*, *Roboto*, *Plus Jakarta Sans*, or *Cabinet Grotesk*).
*   **Font Weights**: Use a distinct scale of weights (e.g., Light 300, Regular 400, Medium 500, Semi-Bold 600, Bold 700) to build visual hierarchy.
*   **Line Heights**: Ensure comfortable readability with line-heights around `1.5` to `1.6` for body text and `1.2` to `1.3` for headings.

### C. Glassmorphism & Visual Polish
*   Use translucent backdrops (`backdrop-filter: blur()`) with semi-transparent borders to create a layered, modern interface.
*   Implement smooth gradients for backgrounds, text clipping, and primary buttons.
*   Use fine details like box-shadows (`rgba(0, 0, 0, 0.05)` or subtle colored glows) to separate layers.

---

## 2. Motion, Transitions & Micro-interactions

An interface should feel alive, responsive, and tactile.

*   **Micro-animations**: Every interactive element (buttons, cards, links, tabs) must have smooth state transitions (e.g., `transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`).
*   **Hover States**: Elevate components slightly on hover, adjust opacity, shift colors, or reveal icons.
*   **Feedback Loops**: Provide instant visual response upon clicking, submitting, or loading (e.g., shimmer/skeleton loaders, spinners, success checkmark animations).
*   **Reduced Motion**: Respect system preferences by wrapping custom animations in `@media (prefers-reduced-motion: reduce)`.

---

## 3. Technology Stack & CSS Philosophy

*   **Styling**: Use Vanilla CSS (or native CSS Modules) for maximum flexibility, customization, and performance. Avoid Tailwind CSS unless explicitly requested.
*   **Component Structure**: Keep components small, modular, single-responsibility, and reusable.
*   **No Placeholders**: Never use gray box placeholders or generic text when generating mockups. If an asset is needed, generate a real design using the proper asset generator or tools.

---

## 4. Accessibility (a11y) & Semantic HTML

Premium design must be usable by everyone.

*   **Semantic HTML**: Use proper tags (`<header>`, `<nav>`, `<main>`, `<article>`, `<section>`, `<footer>`) instead of generic nested `<div>`s.
*   **ARIA Roles**: Implement correct ARIA attributes (`aria-expanded`, `aria-label`, etc.) for custom widgets.
*   **Keyboard Navigation**: Ensure all interactive elements can be focused (`tabindex`) and operated using the keyboard. Outline styles on focus must be visible and aesthetically integrated.
*   **Color Contrast**: Maintain a minimum contrast ratio of 4.5:1 for body text (WCAG AA standard).

---

## 5. SEO Best Practices

All pages must be optimized for search crawlers:

*   **Title & Meta Tags**: Provide unique, descriptive, and keyword-rich titles and meta descriptions for every view.
*   **Heading Structure**: Maintain a strict hierarchical heading outline (`<h1>` -> `<h2>` -> `<h3>`). There must only be **one** `<h1>` tag per page.
*   **Unique IDs**: Assign unique, descriptive `id` attributes to interactive elements to aid automated browser testing and crawlers.

---

## 6. Performance & Optimizations

*   **Asset Optimization**: Serve images in modern formats (WebP, AVIF) and SVGs for icons. Use lazy loading for off-screen images.
*   **Layout Shift**: Prevent layout shifts (CLS) by explicitly specifying `width` and `height` on images and media containers, or using aspect-ratio boxes.
*   **Bundle Size**: Keep external dependencies to a minimum; write native JS/CSS where possible.
