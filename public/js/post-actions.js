(function() {
  'use strict';

  function toast(msg, type) {
    if (typeof showToast === 'function') {
      showToast(msg, type || 'info');
      return;
    }
  }

  function handleLike(btn) {
    var postId = btn.getAttribute('data-post-id');
    if (!postId) return;

    fetch('/api/posts/' + postId + '/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}',
      credentials: 'same-origin'
    }).then(function(r) {
      if (r.status === 401) { toast('Please log in to like this post'); return null; }
      return r.json();
    }).then(function(result) {
      if (!result || !result.success) return;
      var countSpan = btn.querySelector('span');
      if (countSpan) countSpan.textContent = result.likesCount;
      var path = btn.querySelector('svg path');
      if (path && result.liked !== undefined) {
        path.setAttribute('fill', result.liked ? 'currentColor' : 'none');
      }
    }).catch(function(err) { console.error('Like failed:', err); });
  }

  function handleComment(btn) {
    var slug = btn.getAttribute('data-slug');
    if (slug) window.location.href = '/post/' + slug + '#comments';
  }

  function handleShare(btn) {
    var postId = btn.getAttribute('data-post-id');
    if (!postId) return;

    var article = btn.closest('article');
    var linkEl = article ? article.querySelector('a[href*="/post/"]') : null;
    var postUrl = linkEl ? window.location.origin + linkEl.getAttribute('href') : window.location.href;

    fetch('/api/posts/' + postId + '/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}',
      credentials: 'same-origin'
    }).then(function(r) {
      if (r.status === 401) { toast('Please log in to share'); return null; }
      return r.json();
    }).then(function(result) {
      if (result && result.success) {
        var countSpan = btn.querySelector('span');
        if (countSpan) countSpan.textContent = result.shares;
      }
    }).catch(function(err) { console.error('Share count failed:', err); });

    if (navigator.share) {
      navigator.share({ title: document.title, url: postUrl }).catch(function(err) {
        if (err.name !== 'AbortError') console.error('Share failed:', err);
      });
    } else {
      navigator.clipboard.writeText(postUrl).then(function() {
        toast('Link copied to clipboard');
      }).catch(function() {
        toast('Press Ctrl+C to copy the link');
      });
    }
  }

  function handleSave(btn) {
    var postId = btn.getAttribute('data-post-id');
    if (!postId) return;

    fetch('/api/posts/' + postId + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}',
      credentials: 'same-origin'
    }).then(function(r) {
      if (r.status === 401) { toast('Please log in to save'); return null; }
      return r.json();
    }).then(function(result) {
      if (!result || !result.success) return;
      var svg = btn.querySelector('svg');
      if (svg) {
        if (result.saved) {
          svg.setAttribute('fill', '#6d0a0a');
          svg.setAttribute('stroke', '#6d0a0a');
        } else {
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
        }
      }
      toast(result.saved ? 'Saved!' : 'Removed');
    }).catch(function(err) { console.error('Save failed:', err); });
  }

  function handleFollow(btn) {
    var userId = btn.getAttribute('data-user-id');
    if (!userId) return;

    fetch('/api/users/' + userId + '/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}',
      credentials: 'same-origin'
    }).then(function(r) {
      if (r.status === 401) { toast('Please log in to follow'); return null; }
      return r.json();
    }).then(function(result) {
      if (result && result.success) {
        btn.textContent = 'Following';
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
      }
    }).catch(function(err) { console.error('Follow failed:', err); });
  }

  document.addEventListener('click', function(e) {
    var target = e.target.closest('[data-post-id], [data-slug], [data-user-id]');
    if (!target) return;

    if (target.matches('.like-btn') || target.closest('.like-btn')) {
      var btn = target.closest('.like-btn');
      if (btn) handleLike(btn);
    } else if (target.matches('.comment-btn') || target.closest('.comment-btn')) {
      var btn = target.closest('.comment-btn');
      if (btn) handleComment(btn);
    } else if (target.matches('.share-btn') || target.closest('.share-btn')) {
      var btn = target.closest('.share-btn');
      if (btn) handleShare(btn);
    } else if (target.matches('.save-btn') || target.closest('.save-btn')) {
      var btn = target.closest('.save-btn');
      if (btn) handleSave(btn);
    } else if (target.matches('.feed-follow-btn') || target.closest('.feed-follow-btn')) {
      var btn = target.closest('.feed-follow-btn');
      if (btn) handleFollow(btn);
    } else if (target.matches('.suggestion-follow-btn') || target.closest('.suggestion-follow-btn')) {
      var btn = target.closest('.suggestion-follow-btn');
      if (btn) handleFollow(btn);
    }
  });
})();
