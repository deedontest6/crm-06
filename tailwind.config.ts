import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
    	container: {
    		center: true,
    		padding: '2rem',
    		screens: {
    			'2xl': '1400px'
    		}
    	},
    	extend: {
    		colors: {
    			border: 'hsl(var(--border))',
    			input: 'hsl(var(--input))',
    			ring: 'hsl(var(--ring))',
    			background: 'hsl(var(--background))',
    			foreground: 'hsl(var(--foreground))',
    			primary: {
    				DEFAULT: 'hsl(var(--primary))',
    				foreground: 'hsl(var(--primary-foreground))'
    			},
    			secondary: {
    				DEFAULT: 'hsl(var(--secondary))',
    				foreground: 'hsl(var(--secondary-foreground))'
    			},
    			destructive: {
    				DEFAULT: 'hsl(var(--destructive))',
    				foreground: 'hsl(var(--destructive-foreground))'
    			},
    			muted: {
    				DEFAULT: 'hsl(var(--muted))',
    				foreground: 'hsl(var(--muted-foreground))'
    			},
    			accent: {
    				DEFAULT: 'hsl(var(--accent))',
    				foreground: 'hsl(var(--accent-foreground))'
    			},
    			popover: {
    				DEFAULT: 'hsl(var(--popover))',
    				foreground: 'hsl(var(--popover-foreground))'
    			},
    			card: {
    				DEFAULT: 'hsl(var(--card))',
    				foreground: 'hsl(var(--card-foreground))'
    			},
    			sidebar: {
    				DEFAULT: 'hsl(var(--sidebar-background))',
    				foreground: 'hsl(var(--sidebar-foreground))',
    				primary: 'hsl(var(--sidebar-primary))',
    				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
    				accent: 'hsl(var(--sidebar-accent))',
    				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
    				border: 'hsl(var(--sidebar-border))',
    				ring: 'hsl(var(--sidebar-ring))'
    			},
    			stage: {
    				lead: 'hsl(var(--stage-lead))',
    				'lead-foreground': 'hsl(var(--stage-lead-foreground))',
    				discussions: 'hsl(var(--stage-discussions))',
    				'discussions-foreground': 'hsl(var(--stage-discussions-foreground))',
    				qualified: 'hsl(var(--stage-qualified))',
    				'qualified-foreground': 'hsl(var(--stage-qualified-foreground))',
    				rfq: 'hsl(var(--stage-rfq))',
    				'rfq-foreground': 'hsl(var(--stage-rfq-foreground))',
    				offered: 'hsl(var(--stage-offered))',
    				'offered-foreground': 'hsl(var(--stage-offered-foreground))',
    				won: 'hsl(var(--stage-won))',
    				'won-foreground': 'hsl(var(--stage-won-foreground))',
    				lost: 'hsl(var(--stage-lost))',
    				'lost-foreground': 'hsl(var(--stage-lost-foreground))',
    				dropped: 'hsl(var(--stage-dropped))',
    				'dropped-foreground': 'hsl(var(--stage-dropped-foreground))'
    			}
    		},
    		borderRadius: {
    			lg: 'var(--radius)',
    			md: 'calc(var(--radius) - 2px)',
    			sm: 'calc(var(--radius) - 4px)'
    		},
    		keyframes: {
    			'accordion-down': {
    				from: {
    					height: '0'
    				},
    				to: {
    					height: 'var(--radix-accordion-content-height)'
    				}
    			},
    			'accordion-up': {
    				from: {
    					height: 'var(--radix-accordion-content-height)'
    				},
    				to: {
    					height: '0'
    				}
    			},
    			'fade-in-up': {
    				'0%': {
    					opacity: '0',
    					transform: 'translateY(10px)'
    				},
    				'100%': {
    					opacity: '1',
    					transform: 'translateY(0)'
    				}
    			},
    			'slide-up': {
    				'0%': {
    					opacity: '0',
    					transform: 'translateY(20px)'
    				},
    				'100%': {
    					opacity: '1',
    					transform: 'translateY(0)'
    				}
    			},
    			'expand-in': {
    				'0%': {
    					width: '0px',
    					opacity: '0',
    					overflow: 'hidden'
    				},
    				'100%': {
    					width: 'var(--expanded-width, 400px)',
    					opacity: '1'
    				}
    			},
    			'expand-out': {
    				'0%': {
    					width: 'var(--expanded-width, 400px)',
    					opacity: '1'
    				},
    				'100%': {
    					width: '0px',
    					opacity: '0',
    					overflow: 'hidden'
    				}
     		},
     		'slide-in-from-left': {
     			'0%': { transform: 'translateX(-100%)', opacity: '0' },
     			'100%': { transform: 'translateX(0)', opacity: '1' }
     		},
     		'slide-out-to-left': {
     			'0%': { transform: 'translateX(0)', opacity: '1' },
     			'100%': { transform: 'translateX(-100%)', opacity: '0' }
     		},
     		'slide-in-from-right': {
     			'0%': { transform: 'translateX(100%)', opacity: '0' },
     			'100%': { transform: 'translateX(0)', opacity: '1' }
     		},
     		'slide-out-to-right': {
     			'0%': { transform: 'translateX(0)', opacity: '1' },
     			'100%': { transform: 'translateX(100%)', opacity: '0' }
     		},
     		'collapsible-down': {
     			from: { height: '0', opacity: '0' },
     			to: { height: 'var(--radix-collapsible-content-height)', opacity: '1' }
     		},
     		'collapsible-up': {
     			from: { height: 'var(--radix-collapsible-content-height)', opacity: '1' },
     			to: { height: '0', opacity: '0' }
    		},
    		// Subtle slide/fade animations for Kanban expand/collapse
    		'fade-slide-out-right': {
    			'0%': { opacity: '1', transform: 'translateX(0)' },
    			'100%': { opacity: '0', transform: 'translateX(40px)' }
    		},
    		'fade-slide-in-right': {
    			'0%': { opacity: '0', transform: 'translateX(40px)' },
    			'100%': { opacity: '1', transform: 'translateX(0)' }
    		},
    		'fade-slide-out-left': {
    			'0%': { opacity: '1', transform: 'translateX(0)' },
    			'100%': { opacity: '0', transform: 'translateX(-40px)' }
    		},
    		'fade-slide-in-left': {
    			'0%': { opacity: '0', transform: 'translateX(-40px)' },
    			'100%': { opacity: '1', transform: 'translateX(0)' }
    		},
    		'fade-out': {
    			'0%': { opacity: '1' },
    			'100%': { opacity: '0' }
    		},
    		'fade-in': {
    			'0%': { opacity: '0' },
    			'100%': { opacity: '1' }
    		}
    		},
    		animation: {
    			'accordion-down': 'accordion-down 0.2s ease-out',
    			'accordion-up': 'accordion-up 0.2s ease-out',
    			'fade-in-up': 'fade-in-up 0.3s ease-out',
    			'slide-up': 'slide-up 0.3s ease-out',
    			'expand-in': 'expand-in 0.3s ease-out forwards',
     		'expand-out': 'expand-out 0.3s ease-out forwards',
     		'slide-in-from-left': 'slide-in-from-left 0.3s ease-out',
     		'slide-out-to-left': 'slide-out-to-left 0.3s ease-out',
     		'slide-in-from-right': 'slide-in-from-right 0.3s ease-out',
     		'slide-out-to-right': 'slide-out-to-right 0.3s ease-out',
     		'collapsible-down': 'collapsible-down 0.2s ease-out',
     		'collapsible-up': 'collapsible-up 0.2s ease-out',
     		// Subtle Kanban animations
     		'fade-slide-out-right': 'fade-slide-out-right 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
     		'fade-slide-in-right': 'fade-slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
     		'fade-slide-out-left': 'fade-slide-out-left 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
     		'fade-slide-in-left': 'fade-slide-in-left 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
     		'fade-out': 'fade-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
     		'fade-in': 'fade-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards'
    		},
    		boxShadow: {
    			'2xs': 'var(--shadow-2xs)',
    			xs: 'var(--shadow-xs)',
    			sm: 'var(--shadow-sm)',
    			md: 'var(--shadow-md)',
    			lg: 'var(--shadow-lg)',
    			xl: 'var(--shadow-xl)',
    			'2xl': 'var(--shadow-2xl)'
    		},
    		fontFamily: {
    			sans: [
    				'DM Sans',
    				'ui-sans-serif',
    				'system-ui',
    				'-apple-system',
    				'BlinkMacSystemFont',
    				'Segoe UI',
    				'Roboto',
    				'Helvetica Neue',
    				'Arial',
    				'Noto Sans',
    				'sans-serif'
    			],
    			serif: [
    				'Crimson Pro',
    				'ui-serif',
    				'Georgia',
    				'Cambria',
    				'Times New Roman',
    				'Times',
    				'serif'
    			],
    			mono: [
    				'SF Mono',
    				'ui-monospace',
    				'SFMono-Regular',
    				'Menlo',
    				'Monaco',
    				'Consolas',
    				'Liberation Mono',
    				'Courier New',
    				'monospace'
    			]
    		}
    	}
    },
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
