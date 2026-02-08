/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Google/Material Design Color Palette
        primary: {
          50: "#e8f0fe",
          100: "#d2e3fc",
          200: "#aecbfa",
          300: "#8ab4f8",
          400: "#669df6",
          500: "#4285f4",
          600: "#1a73e8", // Main Google Blue
          700: "#1967d2",
          800: "#185abc",
          900: "#174ea6",
        },
        surface: "#ffffff",
        background: "#f8f9fa",
        // Text colors
        text: {
          primary: "#202124",
          secondary: "#5f6368",
          disabled: "#9aa0a6",
        },
        // Border color
        border: "#dadce0",
        // Semantic colors
        error: "#d93025",
        success: "#1e8e3e",
        warning: "#f9ab00",
      },
      borderRadius: {
        // Material Design rounded corners
        'sm': '4px',
        'DEFAULT': '4px',
        'md': '8px',
        'lg': '8px',
        'xl': '12px',
        '2xl': '12px',
      },
      boxShadow: {
        // Material Design Elevation
        "elevation-0": "none",
        "elevation-1": "0 1px 2px 0 rgba(60, 64, 67, 0.3), 0 1px 3px 1px rgba(60, 64, 67, 0.15)",
        "elevation-2": "0 1px 2px 0 rgba(60, 64, 67, 0.3), 0 2px 6px 2px rgba(60, 64, 67, 0.15)",
        "elevation-3": "0 1px 3px 0 rgba(60, 64, 67, 0.3), 0 4px 8px 3px rgba(60, 64, 67, 0.15)",
        "elevation-4": "0 2px 3px 0 rgba(60, 64, 67, 0.3), 0 6px 10px 4px rgba(60, 64, 67, 0.15)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.2s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
