using System;
using System.Collections;
using PX.Data;
using PX.Objects.CR;

namespace PX.Objects.CR
{
    public class OpportunityMaintQuoteGeneratorExt : PXGraphExtension<OpportunityMaint>
    {
        private const string QuoteGeneratorBaseUrl = "https://sales-meadowb.onrender.com/quotes/";

        public static bool IsActive() => true;

        public PXAction<CROpportunity> QuoteGenerator;

        [PXButton(CommitChanges = false, DisplayOnMainToolbar = true)]
        [PXUIField(DisplayName = "Quote Generator", MapEnableRights = PXCacheRights.Select, MapViewRights = PXCacheRights.Select)]
        protected virtual IEnumerable quoteGenerator(PXAdapter adapter)
        {
            CROpportunity row = Base.Opportunity.Current;
            if (row == null)
                return adapter.Get();

            string opportunityId = row.OpportunityID?.Trim();
            if (string.IsNullOrWhiteSpace(opportunityId))
                throw new PXSetPropertyException("Save the opportunity before opening Quote Generator.");

            string url = $"{QuoteGeneratorBaseUrl}?launch=opportunity&opportunityId={Uri.EscapeDataString(opportunityId)}";
            throw new PXRedirectToUrlException(url, PXBaseRedirectException.WindowMode.NewWindow, "Quote Generator");
        }

        protected virtual void _(Events.RowSelected<CROpportunity> e)
        {
            bool enabled = e.Row != null && !string.IsNullOrWhiteSpace(e.Row.OpportunityID);
            QuoteGenerator.SetVisible(true);
            QuoteGenerator.SetEnabled(enabled);
        }
    }
}
