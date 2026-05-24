document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('subscribe-email');
    const subscribeBtn = document.getElementById('subscribe-button');
    if (!emailInput || !subscribeBtn) return;

    subscribeBtn.addEventListener('click', async () => {
        const email = emailInput.value && emailInput.value.trim();
        if (!email) {
            if (typeof showWarningToast === 'function') {
                showWarningToast('Please enter your email address', 'Missing Email');
            } else {
                Swal.fire({ icon: 'warning', title: 'Please enter an email' });
            }
            emailInput.focus();
            return;
        }

        // Validate email format
        const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        if (!emailRegex.test(email)) {
            if (typeof showWarningToast === 'function') {
                showWarningToast('Please enter a valid email address', 'Invalid Email');
            } else {
                Swal.fire({ icon: 'warning', title: 'Invalid email format' });
            }
            emailInput.focus();
            return;
        }

        // Show loading state
        const originalBtnText = subscribeBtn.innerHTML;
        subscribeBtn.disabled = true;
        subscribeBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Subscribing...';
        emailInput.disabled = true;

        try {
            const resp = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.error || 'Subscription failed');
            }

            // Show success toast
            if (typeof showSuccessToast === 'function') {
                showSuccessToast(data.message || 'Successfully subscribed!', 'Welcome!');
            } else {
                Swal.fire({
                    icon: 'success',
                    title: 'Subscribed!',
                    text: data.message || 'Successfully subscribed!'
                });
            }

            emailInput.value = '';
        } catch (err) {
            console.error('Subscribe error:', err);

            // Show error toast
            if (typeof showErrorToast === 'function') {
                showErrorToast(err.message || 'Subscription failed. Please try again.', 'Subscription Error');
            } else {
                Swal.fire({ icon: 'error', title: 'Subscription failed', text: err.message });
            }
        } finally {
            subscribeBtn.disabled = false;
            subscribeBtn.innerHTML = originalBtnText;
            emailInput.disabled = false;
        }
    });

    // Also allow pressing Enter in the email input
    if (emailInput) {
        emailInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                subscribeBtn.click();
            }
        });
    }
});
