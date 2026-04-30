"""
Playwright Stealth Scraper
A web scraper using Playwright with stealth mode to avoid bot detection.
"""

import asyncio
import json
import os
import sys
import subprocess
from datetime import datetime
from pathlib import Path
from playwright.async_api import async_playwright
from playwright_stealth import Stealth
from urllib.parse import urlparse

# Cookie file path
COOKIES_FILE = os.path.join(os.getcwd(), "atlantic_cookies.json")


def is_atlantic_url(url: str) -> bool:
    """
    Check if a URL is from The Atlantic.

    Args:
        url: The URL to check

    Returns:
        bool: True if the URL is from theatlantic.com
    """
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        return "theatlantic.com" in hostname
    except:
        return False


async def scrape_page(url: str, headless: bool = True, wait_selector: str = None):
    """
    Scrape a webpage using Playwright with stealth mode.
    
    Args:
        url: The URL to scrape
        headless: Whether to run browser in headless mode (default: True)
        wait_selector: Optional CSS selector to wait for before scraping
    
    Returns:
        dict: Contains page title, URL, and HTML content
    """
    async with async_playwright() as p:
        # Launch browser (you can change 'chromium' to 'firefox' or 'webkit')
        browser = await p.chromium.launch(headless=headless)
        
        # Create a new page
        page = await browser.new_page()
        
        # Apply stealth mode to avoid bot detection
        stealth = Stealth()
        await stealth.apply_stealth_async(page)
        
        try:
            # Navigate to the target URL
            print(f"Navigating to: {url}")
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            
            # Wait for optional selector if provided
            if wait_selector:
                print(f"Waiting for selector: {wait_selector}")
                await page.wait_for_selector(wait_selector, timeout=10000)
            
            # Extract page information
            title = await page.title()
            current_url = page.url
            
            # Get page content
            html_content = await page.content()
            
            # Get page text (without HTML tags)
            text_content = await page.inner_text("body")
            
            result = {
                "title": title,
                "url": current_url,
                "html": html_content,
                "text": text_content
            }
            
            print(f"Successfully scraped: {title}")
            return result
            
        except Exception as e:
            print(f"Error scraping {url}: {str(e)}")
            raise
        finally:
            await browser.close()


async def scrape_with_screenshot(url: str, screenshot_path: str = "screenshot.png", headless: bool = False):
    """
    Scrape a page and take a screenshot.
    
    Args:
        url: The URL to scrape
        screenshot_path: Path to save the screenshot
        headless: Whether to run browser in headless mode (default: False for screenshots)
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()
        
        # Apply stealth mode
        stealth = Stealth()
        await stealth.apply_stealth_async(page)
        
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await page.screenshot(path=screenshot_path, full_page=True)
            print(f"Screenshot saved to: {screenshot_path}")
        finally:
            await browser.close()


async def test_bot_detection():
    """
    Test if the stealth mode is working by visiting a bot detection test page.
    """
    test_url = "https://arh.antoinevastel.com/bots/areyouheadless"
    print("Testing bot detection bypass...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Apply stealth mode
        stealth = Stealth()
        await stealth.apply_stealth_async(page)
        
        await page.goto(test_url, wait_until="domcontentloaded", timeout=30000)
        
        # Extract the result
        result_element = page.locator("#res")
        result = await result_element.text_content()
        
        print(f"Test result: {result}")
        
        if "not Chrome headless" in result:
            print("✅ Stealth mode is working! Bot detection bypassed.")
        else:
            print("ID")
        
        await browser.close()


async def save_results_to_file(result: dict, filename: str = None):
    """
    Save scraping results to a text file and open it automatically.
    
    Args:
        result: Dictionary containing scraping results
        filename: Optional filename (default: auto-generated with timestamp)
    """
    if filename is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"scraping_results_{timestamp}.txt"
    
    filepath = os.path.join(os.getcwd(), filename)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("SCRAPING RESULTS\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Title: {result['title']}\n")
        f.write(f"URL: {result['url']}\n")
        f.write(f"Scraped at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Content length: {len(result['text'])} characters\n")
        f.write("\n" + "=" * 80 + "\n")
        f.write("FULL CONTENT:\n")
        f.write("=" * 80 + "\n\n")
        f.write(result['text'])
        f.write("\n\n" + "=" * 80 + "\n")
        f.write("END OF RESULTS\n")
        f.write("=" * 80 + "\n")
    
    print(f"\nResults saved to: {filepath}")
    
    # Open the file automatically (works on macOS, Linux, Windows)
    try:
        if os.name == 'nt':  # Windows
            os.startfile(filepath)
        elif os.name == 'posix':  # macOS and Linux
            subprocess.run(['open', filepath] if sys.platform == 'darwin' else ['xdg-open', filepath])
        print(f"Opened results file: {filename}")
    except Exception as e:
        print(f"Could not auto-open file: {e}")
        print(f"Please open manually: {filepath}")
    
    return filepath


async def save_cookies(context):
    """
    Save browser cookies to a file for reuse.
    
    Args:
        context: Playwright browser context
    """
    cookies = await context.cookies()
    with open(COOKIES_FILE, 'w') as f:
        json.dump(cookies, f, indent=2)
    print(f"✅ Cookies saved to {COOKIES_FILE}")


async def load_cookies(context):
    """
    Load cookies from file into browser context.
    
    Args:
        context: Playwright browser context
    
    Returns:
        bool: True if cookies were loaded successfully
    """
    if os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, 'r') as f:
                cookies = json.load(f)
            await context.add_cookies(cookies)
            print(f"✅ Loaded cookies from {COOKIES_FILE}")
            return True
        except Exception as e:
            print(f"⚠️  Could not load cookies: {e}")
            return False
    return False


async def check_cookies_valid(page):
    """
    Check if the loaded cookies are still valid by checking the current page.
    We'll verify by trying to access the target page - if it redirects to login, cookies are invalid.
    
    Args:
        page: Playwright page object
    
    Returns:
        bool: True if cookies appear to be valid
    """
    try:
        # Try accessing a simple page to check if cookies work
        await page.goto("https://www.theatlantic.com", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(2)
        
        # Check URL - if we're redirected to login page, cookies are invalid
        current_url = page.url.lower()
        if "login" in current_url or "account/login" in current_url:
            print("⚠️  Cookies appear to be invalid (redirected to login)")
            return False
        
        # Check if we see login prompts prominently (might indicate not logged in)
        # But don't be too strict - some pages show login links even when logged in
        try:
            # Look for prominent "Sign In" buttons in header/nav
            sign_in_button = page.locator('button:has-text("Sign In"), a:has-text("Sign In")').first
            if await sign_in_button.is_visible(timeout=1000):
                # Check if it's in a prominent location (header/nav)
                # This is a heuristic - if cookies work, we'll know when we try to access content
                pass
        except:
            pass
        
        print("✅ Cookies appear to be valid")
        return True
    except Exception as e:
        print(f"⚠️  Could not verify cookies: {e}")
        # If we can't verify, assume invalid to be safe
        return False


async def login_to_atlantic(page, institution_name: str = "University of Pennsylvania", 
                            username: str = "davidtli", password: str = ""):
    """
    Login to The Atlantic using institutional login.
    
    Args:
        page: Playwright page object
        institution_name: Name of the institution to login with
        username: Penn username for login
        password: Penn password for login
    """
    print(f"\nLogging in with institutional access: {institution_name}")
    
    try:
        # Navigate to The Atlantic homepage first
        print("Navigating to The Atlantic...")
        await page.goto("https://www.theatlantic.com", wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(2)  # Wait for page to load
        
        # Look for login/account link - try multiple possible selectors
        login_selectors = [
            'a[href*="login"]',
            'a[href*="account"]',
            'a:has-text("Sign In")',
            'a:has-text("Login")',
            'a:has-text("My Account")',
            'button:has-text("Sign In")',
            '[data-testid*="login"]',
            '[data-testid*="sign-in"]'
        ]
        
        login_clicked = False
        for selector in login_selectors:
            try:
                login_element = page.locator(selector).first
                if await login_element.is_visible(timeout=3000):
                    print(f"Found login element with selector: {selector}")
                    await login_element.click()
                    login_clicked = True
                    await asyncio.sleep(2)
                    break
            except:
                continue
        
        if not login_clicked:
            # Try navigating directly to login page
            print("Trying direct login URL...")
            await page.goto("https://www.theatlantic.com/account/login/", wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(2)
        
        # Look for "An institutional login" or "Institutional Login" link/button
        institutional_selectors = [
            'a:has-text("An institutional login")',
            'a:has-text("institutional login")',
            'a:has-text("Institutional Login")',
            'a:has-text("Institutional")',
            'button:has-text("institutional")',
            'a[href*="institutional"]',
            'a[href*="shibboleth"]',
            'a[href*="saml"]'
        ]
        
        institutional_clicked = False
        for selector in institutional_selectors:
            try:
                institutional_element = page.locator(selector).first
                if await institutional_element.is_visible(timeout=3000):
                    print(f"Found institutional login with selector: {selector}")
                    await institutional_element.click()
                    institutional_clicked = True
                    await asyncio.sleep(3)
                    break
            except:
                continue
        
        if not institutional_clicked:
            print("⚠️  Could not find 'An institutional login' link. Please check the page manually.")
            print("Current URL:", page.url)
            print("Waiting 10 seconds for manual intervention...")
            await asyncio.sleep(10)
        
        # Look for search/input field to type institution name
        input_selectors = [
            'input[type="text"]',
            'input[type="search"]',
            'input[placeholder*="institution"]',
            'input[placeholder*="university"]',
            'input[placeholder*="school"]',
            'input[name*="institution"]',
            'input[id*="institution"]',
            'input[class*="search"]'
        ]
        
        input_found = False
        input_element = None
        for selector in input_selectors:
            try:
                input_element = page.locator(selector).first
                if await input_element.is_visible(timeout=3000):
                    print(f"Found input field with selector: {selector}")
                    await input_element.fill(institution_name)
                    input_found = True
                    await asyncio.sleep(2)  # Wait for autocomplete popup
                    break
            except:
                continue
        
        if input_found and input_element:
            # Press Enter immediately after typing
            print("Pressing Enter to select institution...")
            await input_element.press("Enter")
            await asyncio.sleep(2)
            
            # Look for continue/submit button
            continue_selectors = [
                'button:has-text("Continue")',
                'button:has-text("continue")',
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("Search")',
                'button:has-text("Find")'
            ]
            
            continue_clicked = False
            for selector in continue_selectors:
                try:
                    continue_button = page.locator(selector).first
                    if await continue_button.is_visible(timeout=3000):
                        print(f"Clicking continue button...")
                        await continue_button.click()
                        continue_clicked = True
                        await asyncio.sleep(3)
                        break
                except:
                    continue
            
            if not continue_clicked:
                print("⚠️  Could not find Continue button. Trying to proceed...")
                await asyncio.sleep(2)
        
        # Wait a moment for page to load, then immediately look for Penn Login screen
        print("Looking for Penn Login form...")
        await asyncio.sleep(2)
        
        # Try to find and fill Penn login credentials right away
        # Look for username field first
        username_selectors = [
            'input[name*="username"]',
            'input[name*="user"]',
            'input[id*="username"]',
            'input[id*="user"]',
            'input[type="text"]',
            'input[placeholder*="username"]',
            'input[placeholder*="PennKey"]',
            'input[name="j_username"]',
            'input[id="username"]'
        ]
        
        username_filled = False
        for selector in username_selectors:
            try:
                username_field = page.locator(selector).first
                if await username_field.is_visible(timeout=3000):
                    print(f"Found username field with selector: {selector}")
                    await username_field.fill(username)
                    username_filled = True
                    await asyncio.sleep(1)
                    break
            except:
                continue
        
        # Look for password field
        password_selectors = [
            'input[name*="password"]',
            'input[id*="password"]',
            'input[type="password"]',
            'input[placeholder*="password"]',
            'input[name="j_password"]',
            'input[id="password"]'
        ]
        
        password_filled = False
        for selector in password_selectors:
            try:
                password_field = page.locator(selector).first
                if await password_field.is_visible(timeout=3000):
                    print(f"Found password field with selector: {selector}")
                    await password_field.fill(password)
                    password_filled = True
                    await asyncio.sleep(1)
                    break
            except:
                continue
        
        # Define submit selectors for use in both paths
        submit_selectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Login")',
            'button:has-text("Sign In")',
            'button:has-text("Log In")',
            'button:has-text("Submit")',
            'input[value*="Login"]',
            'input[value*="Sign"]'
        ]
        
        # If we found login fields, submit right away
        if username_filled and password_filled:
            # Look for submit/login button
            for selector in submit_selectors:
                try:
                    submit_button = page.locator(selector).first
                    if await submit_button.is_visible(timeout=3000):
                        print(f"Clicking login/submit button...")
                        await submit_button.click()
                        await asyncio.sleep(5)  # Wait for login to complete
                        break
                except:
                    continue
            
            print("✅ Login credentials submitted")
            print("⏳ Waiting 60 seconds for you to complete 2FA text code verification...")
            await asyncio.sleep(60)
            print("✅ Continuing after 2FA verification...")
        else:
            # If we didn't find login fields, try clicking the University of Pennsylvania link first
            print("Login fields not found yet, looking for institution link...")
            upenn_selectors = [
                f'a:has-text("{institution_name}")',
                f'button:has-text("{institution_name}")',
                'a[href*="penn"]',
                'a[href*="upenn"]',
                'a[href*="pennkey"]'
            ]
            
            link_clicked = False
            for selector in upenn_selectors:
                try:
                    upenn_link = page.locator(selector).first
                    if await upenn_link.is_visible(timeout=3000):
                        print(f"Found {institution_name} link, clicking...")
                        await upenn_link.click()
                        link_clicked = True
                        await asyncio.sleep(3)  # Wait for redirect
                        break
                except:
                    continue
            
            # Now try to find login fields again after clicking the link
            if link_clicked:
                await asyncio.sleep(2)
                # Retry finding username field
                for selector in username_selectors:
                    try:
                        username_field = page.locator(selector).first
                        if await username_field.is_visible(timeout=3000):
                            print(f"Found username field with selector: {selector}")
                            await username_field.fill(username)
                            username_filled = True
                            await asyncio.sleep(1)
                            break
                    except:
                        continue
                
                # Retry finding password field
                for selector in password_selectors:
                    try:
                        password_field = page.locator(selector).first
                        if await password_field.is_visible(timeout=3000):
                            print(f"Found password field with selector: {selector}")
                            await password_field.fill(password)
                            password_filled = True
                            await asyncio.sleep(1)
                            break
                    except:
                        continue
                
                # Submit if we found both fields
                if username_filled and password_filled:
                    for selector in submit_selectors:
                        try:
                            submit_button = page.locator(selector).first
                            if await submit_button.is_visible(timeout=3000):
                                print(f"Clicking login/submit button...")
                                await submit_button.click()
                                await asyncio.sleep(5)
                                break
                        except:
                            continue
                    print("✅ Login credentials submitted")
                    print("⏳ Waiting 60 seconds for you to complete 2FA text code verification...")
                    await asyncio.sleep(60)
                    print("✅ Continuing after 2FA verification...")
                else:
                    print("⚠️  Could not find username/password fields. You may need to complete login manually.")
                    print("Current URL:", page.url)
                    print("Waiting 15 seconds for manual login completion...")
                    await asyncio.sleep(15)
        
        print(f"Login process completed. Current URL: {page.url}")
        
        # Save cookies after successful login
        context = page.context
        await save_cookies(context)
        
    except Exception as e:
        print(f"Error during login: {str(e)}")
        print("You may need to complete login manually.")
        await asyncio.sleep(10)


async def scrape_page_with_login(url: str, headless: bool = False, wait_selector: str = None, login: bool = True):
    """
    Scrape a webpage using Playwright with stealth mode and optional login.
    For Atlantic URLs: Uses saved cookies if available to avoid re-login.
    For other URLs: Skips login/cookie handling and scrapes directly.

    Args:
        url: The URL to scrape
        headless: Whether to run browser in headless mode (default: False for login)
        wait_selector: Optional CSS selector to wait for before scraping
        login: Whether to perform institutional login if cookies are invalid (default: True)

    Returns:
        dict: Contains page title, URL, and HTML content
    """
    # Check if this is an Atlantic URL
    is_atlantic = is_atlantic_url(url)

    # For non-Atlantic URLs, we can run headless by default
    if not is_atlantic:
        headless = True
        print(f"\n📰 Non-Atlantic URL detected. Skipping login/cookies.")

    async with async_playwright() as p:
        # Launch browser (non-headless recommended for login)
        browser = await p.chromium.launch(headless=headless)

        # Create a browser context (needed for cookies)
        context = await browser.new_context()

        # Create a new page
        page = await context.new_page()

        # Apply stealth mode to avoid bot detection
        stealth = Stealth()
        await stealth.apply_stealth_async(page)

        try:
            # Only handle login/cookies for Atlantic URLs
            if is_atlantic:
                # Try to load saved cookies first
                cookies_loaded = await load_cookies(context)
                cookies_valid = False

                if cookies_loaded:
                    # Check if cookies are still valid
                    cookies_valid = await check_cookies_valid(page)

                # Only perform login if cookies don't exist or are invalid
                if login and (not cookies_loaded or not cookies_valid):
                    print("\n🔐 Cookies not found or invalid. Logging in...")
                    await login_to_atlantic(page, username="davidtli", password="")
                elif cookies_valid:
                    print("\n✅ Using saved cookies - no login needed!")
            
            # Navigate to the target URL
            print(f"\nNavigating to: {url}")
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await asyncio.sleep(2)  # Wait for page to fully load
            
            # Wait for optional selector if provided
            if wait_selector:
                print(f"Waiting for selector: {wait_selector}")
                await page.wait_for_selector(wait_selector, timeout=10000)
            
            # Extract page information
            title = await page.title()
            current_url = page.url
            
            # Get page content
            html_content = await page.content()
            
            # Get page text (without HTML tags)
            text_content = await page.inner_text("body")
            
            result = {
                "title": title,
                "url": current_url,
                "html": html_content,
                "text": text_content
            }
            
            print(f"Successfully scraped: {title}")
            return result
            
        except Exception as e:
            print(f"Error scraping {url}: {str(e)}")
            raise
        finally:
            await browser.close()


async def open_browser_window(url: str, keep_open: bool = True):
    """
    Open a new browser window to display the scraped page.
    
    Args:
        url: The URL to open in the browser
        keep_open: Whether to keep the browser open (default: True)
    """
    async with async_playwright() as p:
        # Launch browser in non-headless mode so user can see it
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        # Apply stealth mode
        stealth = Stealth()
        await stealth.apply_stealth_async(page)
        
        print(f"\nOpening browser window for: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        
        if keep_open:
            print("Browser window is open. Close the browser window manually when done, or wait 60 seconds...")
            # Keep browser open - user can close it manually, or it will auto-close after 60 seconds
            await asyncio.sleep(60)
        else:
            await asyncio.sleep(5)  # Show for 5 seconds
        
        await browser.close()
        print("Browser window closed.")


async def main():
    """
    Main function - scrapes any URL passed as argument.
    For Atlantic URLs: Uses login/cookies for authentication.
    For other URLs: Scrapes directly without login.
    """
    # Get URL from command line argument or use default
    if len(sys.argv) > 1:
        target_url = sys.argv[1]
    else:
        # Default example URL
        target_url = "https://www.theatlantic.com/politics/2026/01/greg-bovino-demoted-minneapolis-border-patrol/685770/"

    print("=" * 50)
    print("Playwright Stealth Scraper")
    print("=" * 50)

    # Check if this is an Atlantic URL
    if is_atlantic_url(target_url):
        print(f"Atlantic URL -- login/cookies")
    else:
        print(f"Regular URL -- no login")

    # First, test if stealth mode is working
    await test_bot_detection()

    print("\n" + "=" * 50)

    # Scrape the target site (login only applies to Atlantic URLs)
    print(f"\nScraping: {target_url}")
    result = await scrape_page_with_login(target_url, login=True)

    print(f"\nPage Title: {result['title']}")
    print(f"Page URL: {result['url']}")
    print(f"Content length: {len(result['text'])} characters")

    # Save results to file and open it
    print("\n" + "=" * 50)
    results_file = await save_results_to_file(result)
    print(f"\n✅ Results saved and opened in: {results_file}")


if __name__ == "__main__":
    asyncio.run(main())
