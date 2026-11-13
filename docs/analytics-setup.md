# Connect Agross Admin to Google Analytics

1. In [Google Analytics](https://analytics.google.com/), create or select a GA4 property owned by Agromaxx. Set the reporting time zone to India and use a dedicated web data stream for `https://www.agross.in`. Copy the numeric property ID from Property details and the `G-…` measurement ID from the web data stream. Switch off Enhanced measurement for this stream. The site sends its own page views and keeps form interactions out of the analytics setup.
2. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Analytics Data API** and create a service account and JSON key. In GA4 **Admin → Property access management**, add the service account's email as a **Viewer** on the Agross property. See the [Google Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart).
3. Add the following in the Agross Vercel project's **Settings → Environment Variables**, selecting **Production**. Mark the key as sensitive and paste the JSON contents into Vercel. Keep the key file outside the repository.

   | Variable | Value |
   | --- | --- |
   | `GA_MEASUREMENT_ID` | The `G-…` web stream ID |
   | `GA_PROPERTY_ID` | The numeric GA4 property ID |
   | `GA_SERVICE_ACCOUNT_JSON` | The Google Cloud service account key JSON |

4. Apply the database migrations before deploying to Production, including `008_analytics_last_day.sql` for the 24-hour report. Keep **Enable access to System Environment Variables** on in Vercel and deploy the new commit. Open the public site, select **Allow analytics**, and check GA4 Realtime for the visit. Then sign in as the Agross owner and open **Analytics**. [Google reporting freshness](https://support.google.com/analytics/answer/11198161)

Visitors can change their analytics choice on the Privacy Policy page. The tracking tag loads on the live Agross site after opt-in. For campaigns you control, use tagged links, for example `https://www.agross.in/?utm_source=whatsapp&utm_medium=social&utm_campaign=dealer_outreach`. Use campaign labels that contain no names, email addresses, or other personal information. [Google campaign URL guide](https://support.google.com/analytics/answer/10917952)

The Analytics tab uses the existing owner permission and fetches only aggregate reports. **Last 30 minutes** is the default and uses Google's Realtime API for active users and page views. **Last 1 day** uses a separate 24-hour report ending at the last completed minute, calculated in India time to match the GA4 property. Google may take up to 48 hours to process recent activity. **Last 7 days** and **Last 30 days** show completed days through yesterday. Visitors are distinct users measured by GA4 for the whole period. Visits are sessions, and one visitor can start multiple sessions.
