(function () {
    'use strict';

    const measurementId = 'GA_MEASUREMENT_ID';
    const url = new URL(window.location.href);
    if (!/^G-[A-Z0-9]+$/.test(measurementId) ||
        !['agross.in', 'www.agross.in'].includes(url.hostname) ||
        window.self !== window.top || url.searchParams.has('preview')) return;

    const preferenceKey = 'agross.analytics';
    const disableKey = 'ga-disable-' + measurementId;
    let preference;
    try { preference = localStorage.getItem(preferenceKey); } catch { /* Browser storage can be blocked. */ }
    let tagLoaded = false;

    function trackPage() {
        window[disableKey] = false;
        if (tagLoaded) return;
        tagLoaded = true;
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag('consent', 'default', {
            analytics_storage: 'granted',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied'
        });
        gtag('js', new Date());

        const pageLocation = new URL(url.pathname, url.origin);
        for (const field of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content', 'utm_source_platform']) {
            const value = url.searchParams.get(field);
            if (value) pageLocation.searchParams.set(field, value.slice(0, 100));
        }
        const pageReferrer = document.referrer ? new URL(document.referrer).origin + '/' : '';
        gtag('config', measurementId, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            page_location: pageLocation.href,
            page_referrer: pageReferrer
        });
        gtag('event', 'page_view', { send_to: measurementId });

        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
        document.head.append(script);
    }

    function stopTracking() {
        window[disableKey] = true;
        for (const cookie of ['_ga', '_ga_' + measurementId.slice(2)]) {
            document.cookie = cookie + '=; Max-Age=0; Path=/';
            document.cookie = cookie + '=; Max-Age=0; Path=/; Domain=agross.in';
        }
    }

    if (preference === 'allow') trackPage();
    else if (preference === 'decline') stopTracking();

    const panel = document.createElement('section');
    panel.className = 'analytics-consent';
    panel.setAttribute('aria-label', 'Analytics cookies');
    panel.hidden = true;

    const text = document.createElement('p');
    text.textContent = 'Allow analytics cookies so we can see how visitors find and use Agross.';
    const controls = document.createElement('div');
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.textContent = 'Allow analytics';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.textContent = 'Decline';
    const privacy = document.createElement('a');
    privacy.href = '/privacy.html#cookies';
    privacy.textContent = 'Privacy policy';
    controls.append(allow, decline, privacy);
    panel.append(text, controls);

    const settings = document.querySelector('[data-analytics-settings]');
    const status = document.querySelector('[data-analytics-status]');
    function showStatus() {
        if (status) status.textContent = preference === 'allow' ? 'Analytics cookies allowed.' :
            preference === 'decline' ? 'Analytics cookies declined.' : 'No analytics choice saved.';
    }
    function choose(value) {
        preference = value;
        try { localStorage.setItem(preferenceKey, value); } catch { /* Apply the choice on this page. */ }
        if (value === 'allow') trackPage();
        else stopTracking();
        panel.hidden = true;
        showStatus();
        if (settings) settings.focus();
    }
    allow.addEventListener('click', () => choose('allow'));
    decline.addEventListener('click', () => choose('decline'));
    if (settings) {
        settings.hidden = false;
        showStatus();
        settings.addEventListener('click', () => {
            panel.hidden = false;
            allow.focus();
        });
    }

    if (!preference || settings) {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = '/assets/css/analytics.css';
        document.head.append(style);
        document.body.append(panel);
        panel.hidden = Boolean(preference);
    }
}());
